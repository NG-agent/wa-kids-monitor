import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { queries } from "./db";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const FRAMES_DIR = path.join(process.cwd(), "data", "frames");
fs.mkdirSync(FRAMES_DIR, { recursive: true });

// ── Config ──

const MODEL_VISION = "google/gemini-2.0-flash-001"; // supports vision
const MODEL_AUDIO = "google/gemini-2.0-flash-001";   // supports audio via transcription

interface MediaAnalysisResult {
  type: "image" | "video" | "audio";
  description: string;
  flags: MediaFlag[];
  transcription?: string; // for audio/video with speech
  cost: number;
}

interface MediaFlag {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  detail: string;
  confidence: number;
}

interface MessageRow {
  id: number;
  account_id: string;
  msg_id: string;
  chat_jid: string;
  chat_name: string;
  sender_name: string;
  from_child: number;
  body: string;
  timestamp: number;
  media_type: string;
  media_path: string;
}

// ── LLM Client ──

function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Kids Monitor Media Analyzer",
    },
  });
}

const VISION_PROMPT = `אתה מערכת הגנה על ילדים. אתה מנתח תמונה שנשלחה בוואטסאפ של ילד.

בדוק האם התמונה מכילה:
🔴 CRITICAL:
- תוכן מיני / עירום / עירום חלקי
- סמים, אביזרי סמים, אלכוהול
- פגיעה עצמית (חתכים, שריטות)
- נשק

🟠 HIGH:
- אלימות / דימומים
- מסרים מאיימים (טקסט בתמונה)
- screenshot של שיחות חשודות

🟡 MEDIUM:
- תוכן מפחיד / מטריד
- מידע אישי חשוף (כתובת, מס׳ טלפון)

תאר את התמונה בקצרה (בעברית) ודווח על כל ממצא חשוד.

ענה ב-JSON:
{
  "description": "תיאור קצר של התמונה בעברית",
  "flags": [
    {
      "severity": "critical|high|medium|low",
      "category": "sexual|drugs|self_harm|violence|weapon|threat|personal_info|other",
      "detail": "פירוט הממצא בעברית",
      "confidence": 0.0-1.0
    }
  ]
}

אם אין ממצאים חשודים: { "description": "...", "flags": [] }`;

const AUDIO_TRANSCRIPTION_PROMPT = `תמלל את ההקלטה הבאה. ההקלטה בעברית/ערבית/אנגלית או שילוב שלהם.
החזר JSON:
{
  "transcription": "הטקסט המתומלל",
  "language": "he|ar|en|mixed"
}`;

// ── Analyzers ──

/**
 * Analyze an image using Gemini Vision
 */
export async function analyzeImage(imagePath: string): Promise<MediaAnalysisResult> {
  const client = getClient();

  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png"
    : ext === ".webp" ? "image/webp"
    : "image/jpeg";

  const response = await client.chat.completions.create({
    model: MODEL_VISION,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: "נתח את התמונה הזו." },
        ],
      },
    ],
  });

  const usage = response.usage;
  const cost = ((usage?.prompt_tokens || 0) / 1_000_000) * 0.1 +
    ((usage?.completion_tokens || 0) / 1_000_000) * 0.4;

  const content = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);

  return {
    type: "image",
    description: parsed.description || "",
    flags: (parsed.flags || []).filter((f: any) => f.confidence >= 0.5),
    cost,
  };
}

/**
 * Analyze a video — extract key frames and analyze each
 */
export async function analyzeVideo(videoPath: string): Promise<MediaAnalysisResult> {
  const accountDir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const framesDir = path.join(FRAMES_DIR, baseName);
  fs.mkdirSync(framesDir, { recursive: true });

  let totalCost = 0;
  const allFlags: MediaFlag[] = [];
  const descriptions: string[] = [];

  try {
    // Extract frames: 1 frame every 3 seconds, max 10 frames
    await execAsync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/3" -frames:v 10 -q:v 2 "${framesDir}/frame_%03d.jpg" -y 2>/dev/null`
    );

    const frames = fs.readdirSync(framesDir)
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .slice(0, 10);

    if (frames.length === 0) {
      return { type: "video", description: "[לא ניתן לחלץ פריימים]", flags: [], cost: 0 };
    }

    // Analyze each frame
    for (const frame of frames) {
      const framePath = path.join(framesDir, frame);
      try {
        const result = await analyzeImage(framePath);
        totalCost += result.cost;
        if (result.description) descriptions.push(result.description);
        allFlags.push(...result.flags);
      } catch { /* skip failed frames */ }
    }

    // Extract and transcribe audio if video has speech
    let transcription: string | undefined;
    try {
      const audioPath = path.join(framesDir, "audio.ogg");
      await execAsync(`ffmpeg -i "${videoPath}" -vn -acodec libopus "${audioPath}" -y 2>/dev/null`);
      if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
        const audioResult = await analyzeAudio(audioPath);
        totalCost += audioResult.cost;
        transcription = audioResult.transcription;
        allFlags.push(...audioResult.flags);
      }
    } catch { /* no audio or extraction failed */ }

    // Cleanup frames
    try { fs.rmSync(framesDir, { recursive: true }); } catch {}

    // Deduplicate flags by category
    const uniqueFlags = deduplicateFlags(allFlags);

    return {
      type: "video",
      description: descriptions[0] || "[סרטון]",
      flags: uniqueFlags,
      transcription,
      cost: totalCost,
    };
  } catch (err) {
    try { fs.rmSync(framesDir, { recursive: true }); } catch {}
    return { type: "video", description: "[שגיאה בניתוח סרטון]", flags: [], cost: totalCost };
  }
}

/**
 * Analyze audio — transcribe and then scan text
 */
export async function analyzeAudio(audioPath: string): Promise<MediaAnalysisResult> {
  const client = getClient();

  // Read audio and send to Gemini for transcription
  const audioData = fs.readFileSync(audioPath);
  const base64 = audioData.toString("base64");
  const ext = path.extname(audioPath).toLowerCase();
  const mimeType = ext === ".mp3" ? "audio/mpeg"
    : ext === ".m4a" ? "audio/mp4"
    : ext === ".wav" ? "audio/wav"
    : "audio/ogg";

  // Step 1: Transcribe
  let transcription = "";
  let cost = 0;

  try {
    const transcribeResponse = await client.chat.completions.create({
      model: MODEL_AUDIO,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AUDIO_TRANSCRIPTION_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_audio" as any,
              input_audio: { data: base64, format: ext.replace(".", "") || "ogg" },
            } as any,
            { type: "text", text: "תמלל את ההקלטה." },
          ],
        },
      ],
    });

    const usage = transcribeResponse.usage;
    cost += ((usage?.prompt_tokens || 0) / 1_000_000) * 0.1 +
      ((usage?.completion_tokens || 0) / 1_000_000) * 0.4;

    const content = transcribeResponse.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    transcription = parsed.transcription || "";
  } catch {
    // Gemini might not support audio input via OpenRouter — fallback to Whisper
    try {
      const whisperResult = await transcribeWithWhisper(audioPath);
      transcription = whisperResult;
    } catch {
      return { type: "audio", description: "[לא ניתן לתמלל]", flags: [], cost };
    }
  }

  if (!transcription) {
    return { type: "audio", description: "[הקלטה ריקה או לא ברורה]", flags: [], cost };
  }

  // Step 2: Analyze the transcription for threats
  const analyzeResponse = await client.chat.completions.create({
    model: MODEL_AUDIO,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `אתה מערכת הגנה על ילדים. קיבלת תמלול של הודעה קולית בוואטסאפ של ילד.
בדוק האם התוכן מכיל:
- בריונות, איומים, השפלות
- תוכן מיני
- שיחה על סמים/אלכוהול
- ביטויים אובדניים
- טיפוח (grooming)
- חרם / הדרה חברתית

ענה ב-JSON:
{
  "flags": [
    {
      "severity": "critical|high|medium|low",
      "category": "exclusion|suicidal|grooming|sexual|drugs|bullying|violence|pressure|language",
      "detail": "פירוט בעברית",
      "confidence": 0.0-1.0
    }
  ]
}

אם אין ממצאים: { "flags": [] }`,
      },
      { role: "user", content: `תמלול הודעה קולית:\n"${transcription}"` },
    ],
  });

  const usage2 = analyzeResponse.usage;
  cost += ((usage2?.prompt_tokens || 0) / 1_000_000) * 0.1 +
    ((usage2?.completion_tokens || 0) / 1_000_000) * 0.4;

  const parsed2 = JSON.parse(analyzeResponse.choices[0]?.message?.content || "{}");

  return {
    type: "audio",
    description: transcription.slice(0, 200),
    flags: (parsed2.flags || []).filter((f: any) => f.confidence >= 0.5),
    transcription,
    cost,
  };
}

/**
 * Fallback: transcribe with local Whisper (if installed)
 */
async function transcribeWithWhisper(audioPath: string): Promise<string> {
  // Try whisper CLI
  const outputDir = path.dirname(audioPath);
  await execAsync(
    `whisper "${audioPath}" --model small --language he --output_format txt --output_dir "${outputDir}" 2>/dev/null`
  );
  const txtPath = audioPath.replace(path.extname(audioPath), ".txt");
  if (fs.existsSync(txtPath)) {
    const text = fs.readFileSync(txtPath, "utf-8").trim();
    fs.unlinkSync(txtPath);
    return text;
  }
  throw new Error("Whisper transcription failed");
}

// ── Batch Media Analysis (called during scan) ──

/**
 * Analyze all unprocessed media for an account.
 * Returns flags that should become alerts.
 */
export async function analyzeAccountMedia(
  accountId: string,
  limit: number = 50,
  onProgress?: (msg: string) => void
): Promise<{ flags: (MediaFlag & { messageId: number; chatJid: string; chatName: string; mediaType: string })[]; cost: number }> {
  const unanalyzed = queries.getUnanalyzedMedia.all(accountId, limit) as MessageRow[];

  if (unanalyzed.length === 0) {
    return { flags: [], cost: 0 };
  }

  onProgress?.(`🖼️ מנתח ${unanalyzed.length} קבצי מדיה...`);

  let totalCost = 0;
  const allFlags: (MediaFlag & { messageId: number; chatJid: string; chatName: string; mediaType: string })[] = [];

  for (const msg of unanalyzed) {
    if (!msg.media_path || !fs.existsSync(msg.media_path)) {
      queries.updateMediaAnalysis.run("file_missing", msg.id);
      continue;
    }

    let result: MediaAnalysisResult;

    try {
      switch (msg.media_type) {
        case "image":
        case "sticker":
          result = await analyzeImage(msg.media_path);
          break;
        case "video":
          result = await analyzeVideo(msg.media_path);
          break;
        case "audio":
          result = await analyzeAudio(msg.media_path);
          break;
        default:
          queries.updateMediaAnalysis.run("unsupported_type", msg.id);
          continue;
      }

      totalCost += result.cost;

      // Save analysis
      queries.updateMediaAnalysis.run(JSON.stringify({
        description: result.description,
        flags: result.flags,
      }), msg.id);

      // Save transcription if available
      if (result.transcription) {
        queries.updateTranscription.run(result.transcription, msg.id);
      }

      // Collect flags
      for (const flag of result.flags) {
        allFlags.push({
          ...flag,
          messageId: msg.id,
          chatJid: msg.chat_jid,
          chatName: msg.chat_name || msg.chat_jid.split("@")[0],
          mediaType: msg.media_type,
        });
      }

      const icon = { image: "🖼️", video: "🎬", audio: "🎤", sticker: "😀" }[msg.media_type] || "📎";
      if (result.flags.length > 0) {
        onProgress?.(`${icon} ${msg.chat_name}: ${result.flags.length} ממצאים`);
      }
    } catch (err) {
      queries.updateMediaAnalysis.run(`error: ${err}`, msg.id);
    }
  }

  return { flags: allFlags, cost: totalCost };
}

/**
 * Analyze unanalyzed media for a specific chat.
 */
export async function analyzeChatMedia(
  accountId: string,
  chatJid: string,
  limit: number = 20,
  onProgress?: (msg: string) => void
): Promise<{ flags: (MediaFlag & { messageId: number; chatJid: string; chatName: string; mediaType: string })[]; cost: number }> {
  const unanalyzed = queries.getUnanalyzedMediaForChat.all(accountId, chatJid, limit) as MessageRow[];

  if (unanalyzed.length === 0) {
    return { flags: [], cost: 0 };
  }

  let totalCost = 0;
  const allFlags: (MediaFlag & { messageId: number; chatJid: string; chatName: string; mediaType: string })[] = [];

  for (const msg of unanalyzed) {
    if (!msg.media_path || !fs.existsSync(msg.media_path)) {
      queries.updateMediaAnalysis.run("file_missing", msg.id);
      continue;
    }

    let result: MediaAnalysisResult;

    try {
      switch (msg.media_type) {
        case "image":
        case "sticker":
          result = await analyzeImage(msg.media_path);
          break;
        case "video":
          result = await analyzeVideo(msg.media_path);
          break;
        case "audio":
          result = await analyzeAudio(msg.media_path);
          break;
        default:
          queries.updateMediaAnalysis.run("unsupported_type", msg.id);
          continue;
      }

      totalCost += result.cost;
      queries.updateMediaAnalysis.run(JSON.stringify({
        description: result.description,
        flags: result.flags,
      }), msg.id);

      if (result.transcription) {
        queries.updateTranscription.run(result.transcription, msg.id);
      }

      for (const flag of result.flags) {
        allFlags.push({
          ...flag,
          messageId: msg.id,
          chatJid: msg.chat_jid,
          chatName: msg.chat_name || msg.chat_jid.split("@")[0],
          mediaType: msg.media_type,
        });
      }
    } catch (err) {
      queries.updateMediaAnalysis.run(`error: ${err}`, msg.id);
    }
  }

  return { flags: allFlags, cost: totalCost };
}

// ── Helpers ──

function deduplicateFlags(flags: MediaFlag[]): MediaFlag[] {
  const seen = new Map<string, MediaFlag>();
  for (const flag of flags) {
    const key = `${flag.category}_${flag.severity}`;
    const existing = seen.get(key);
    if (!existing || flag.confidence > existing.confidence) {
      seen.set(key, flag);
    }
  }
  return Array.from(seen.values());
}
