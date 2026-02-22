import OpenAI from "openai";
import fs from "fs";
import { queries } from "./db";
import { shouldScanChat, getAccount, calculateAge, logoutAccount, getParentsForChild } from "./account-manager";
import { analyzeAccountMedia, analyzeChatMedia } from "./media-analyzer";
import { getTipsForChild, formatKidTipsWhatsApp } from "./kid-tips";
import { getNextTopic, formatTopicWhatsApp } from "./conversation-topics";

// ── Config ──

const SCAN_MESSAGES = 150;   // last N messages to scan per chat
const CONTEXT_KEEP = 15;     // messages to keep per chat after scan (for next scan's context)
const BATCH_SIZE = 50;       // messages per AI call
const MODEL_FAST = "google/gemini-2.0-flash-lite-001";
const MODEL_DEEP = "google/gemini-2.0-flash-001";

interface NewContactInfo {
  jid: string;
  name: string;
  messageCount: number;
  firstSeen: number;
  assessment: string | null; // AI assessment of the conversation
}

interface SuspiciousGroup {
  jid: string;
  name: string;
  category: string;
  reason: string;
}

interface ScanResult {
  scanId: number;
  accountId: string;
  messagesScanned: number;
  messagesNew: number;
  chatsScanned: number;
  chatsSkipped: number;
  alerts: Alert[];
  newContacts: NewContactInfo[];
  suspiciousGroups: SuspiciousGroup[];
  skippedMedia: number;
  cost: number;
  durationMs: number;
}

interface Alert {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  chatJid: string;
  chatName: string;
  summary: string;
  recommendation: string;
  confidence: number;
}

interface MessageRow {
  id: number;
  account_id: string;
  msg_id: string;
  chat_jid: string;
  chat_name: string;
  sender_jid: string;
  sender_name: string;
  from_child: number;
  body: string;
  timestamp: number;
  media_type: string | null;
  media_path: string | null;
  transcription: string | null;
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
      "X-Title": "Kids Monitor Scanner",
    },
  });
}

// ── Scan Prompt ──

function buildSystemPrompt(childAge: number | null, childGender: string | null): string {
  // Age-based sensitivity
  let ageGuidance = "";
  const age = childAge || 12;
  if (age <= 10) {
    ageGuidance = `
⚠️ הילד בן/בת ${age} — רגישות מאוד גבוהה!
- סמן כל שפה מינית, גם קלה
- סמן כל תוכן אלים
- סף נמוך לכל הקטגוריות
- שים לב במיוחד לאנשים מבוגרים שמדברים עם הילד`;
  } else if (age <= 13) {
    ageGuidance = `
⚠️ הילד בן/בת ${age} — רגישות גבוהה
- חרם חברתי שכיח במיוחד בגיל הזה — שים לב במיוחד
- סמן כל תוכן הקשור לזוגיות/דייטינג
- סף גבוה לבריונות — שכיחה מאוד בגיל`;
  } else if (age <= 16) {
    ageGuidance = `
הילד בן/בת ${age} — רגישות בינונית
- התמקד באיומים רציניים: סמים, טיפוח, אובדנות
- שפה גסה מסוימת טבעית לגיל — אל תדווח על קללות קלות
- שים לב לסחיטה מינית ו-sexting`;
  } else {
    ageGuidance = `
הילד בן/בת ${age} — התמקד בקריטי בלבד
- סמים, ניצול מיני, אובדנות
- קונפליקטים חברתיים רגילים — אל תדווח
- שפה גסה ובדיחות — לא רלוונטי בגיל`;
  }

  // Gender-specific guidance
  let genderGuidance = "";
  if (childGender === "girl") {
    genderGuidance = `
👧 ילדה — רגישות מוגברת ל:
- טיפוח (grooming) והטרדה מינית
- דימוי גוף שלילי, הערות על מראה
- הדרה חברתית ורכילות
- לחץ חברתי לשלוח תמונות`;
  } else if (childGender === "boy") {
    genderGuidance = `
👦 ילד — רגישות מוגברת ל:
- אלימות ואיומים פיזיים
- שימוש בסמים ואלכוהול
- בריונות אגרסיבית
- אתגרים מסוכנים`;
  }

  return `אתה מערכת הגנה על ילדים. אתה מנתח שיחות וואטסאפ של ילד ומזהה תוכן מסוכן.
${ageGuidance}
${genderGuidance}

אתה מחפש את הקטגוריות הבאות (בסדר חומרה):

🔴 CRITICAL:
1. חרם (exclusion) — הדרה חברתית, בידוד מכוון, "אל תזמינו אותו", הסרה מקבוצות, דיבור מאחורי הגב
2. אובדנות (suicidal) — מחשבות אובדניות, פגיעה עצמית, "לא רוצה לחיות", "מעדיף למות", "אין טעם", הודעות פרידה
3. טיפוח (grooming) — מבוגר שבונה קשר לניצול מיני: חמאות מוגזמות, סודיות, מתנות, העלאת נושאים מיניים בהדרגה, בקשות לתמונות
4. הטרדה מינית (sexual) — תוכן מיני לא רצוי, sexting, שליחת/בקשת תמונות עירום, לחץ מיני, הפצת תמונות אינטימיות
5. סמים ואלכוהול (drugs) — שיחות על צריכה/קנייה/מכירה, קודים: 🍃 ❄️ 💊 420, "חומר", "בוא נעשן", "מי מביא וודקה"

🟠 HIGH:
6. בריונות (bullying) — השפלות, קריאת שמות, איומים, סחיטה, צילום מביך
7. אלימות (violence) — איומי אלימות, נשק, "אשבור לך את הצורה", תכנון קטטות

🟡 MEDIUM:
8. לחץ חברתי (pressure) — "אם לא תעשה X", "כולם עושים את זה", אתגרים מסוכנים
9. שפה פוגענית (language) — גזענות, הומופוביה, שפה מבזה חריגה

חשוב:
- אתה מקבל הודעות חדשות + הקשר (הודעות קודמות). נתח את ההודעות החדשות בהקשר של השיחה.
- הילד מסומן כ-[ילד]. שאר ההודעות ממשתתפים אחרים.
- שים לב לסלנג ישראלי, עברית, ערבית, אנגלית, אימוג'ים וקודים.
- אל תדווח על שיחות תקינות. רק ממצאים אמיתיים.
- ציין confidence (0-1). אל תדווח על דברים מתחת ל-0.5.
- הסיכום וההמלצה חייבים להיות בעברית.
- אל תצטט את הטקסט המקורי — רק סכם.
- חשוב מאוד: בסיכום ובהמלצה אל תצטט טקסט מקורי מהודעות. תאר את הממצא בצורה כללית. אפשר לציין שמות אנשי קשר וקבוצות.

ענה ב-JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low|info",
      "category": "exclusion|suicidal|grooming|sexual|drugs|bullying|violence|pressure|language",
      "summary": "סיכום קצר בעברית של מה שזוהה",
      "recommendation": "המלצה להורה בעברית",
      "confidence": 0.0-1.0
    }
  ]
}

אם אין ממצאים, החזר: { "findings": [] }`;
}

// ── Scanner ──

/**
 * Run a full scan on an account.
 * Scans the last SCAN_MESSAGES (150) messages per chat.
 * Flow per chat: text analysis → media analysis → update cursor → cleanup raw data.
 */
export async function scanAccount(
  accountId: string,
  onProgress?: (msg: string) => void
): Promise<ScanResult> {
  const start = Date.now();
  const account = getAccount(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  const childName = account.child_name || "הילד";
  const childAge = calculateAge(account.child_birthdate);
  const childGender = account.child_gender || null;

  // Create scan record
  const scanRow = queries.createScan.get(accountId, MODEL_FAST) as { id: number };
  const scanId = scanRow.id;

  try {
    // Get all chats with messages
    const chats = queries.getDistinctChats.all(accountId) as { chat_jid: string; chat_name: string; msg_count: number }[];

    if (chats.length === 0) {
      onProgress?.("✅ אין הודעות לסריקה");
      queries.updateScan.run("completed", 0, 0, 0, 0, 0, 0, null, scanId);
      return {
        scanId, accountId, messagesScanned: 0, messagesNew: 0,
        chatsScanned: 0, chatsSkipped: 0, alerts: [],
        newContacts: [], suspiciousGroups: [], skippedMedia: 0,
        cost: 0, durationMs: Date.now() - start,
      };
    }

    let totalScanned = 0;
    let chatsScanned = 0;
    let chatsSkipped = 0;
    let totalCost = 0;
    const allAlerts: Alert[] = [];
    let skippedMediaCount = 0;
    const isFreePlan = checkIfFreePlan(accountId);

    onProgress?.(`🔍 סורק ${chats.length} צ׳אטים${isFreePlan ? " (תוכנית חינם — ללא מדיה)" : ""}`);

    for (const chat of chats) {
      const chatJid = chat.chat_jid;
      const chatName = chat.chat_name || chatJid.split("@")[0];

      // Check if safe → skip + cleanup
      if (!shouldScanChat(accountId, chatJid)) {
        chatsSkipped++;
        cleanupChatData(accountId, chatJid);
        continue;
      }

      // Get last 150 messages for this chat
      const messages = queries.getLastNMessages.all(accountId, chatJid, SCAN_MESSAGES) as MessageRow[];
      if (messages.length === 0) continue;

      // Check cursor — skip if already scanned this exact position
      const cursor = queries.getCursor.get(accountId, chatJid) as any;
      const lastMsg = messages[messages.length - 1];
      if (cursor && cursor.last_msg_id === lastMsg.msg_id) {
        chatsSkipped++;
        continue; // no new messages since last scan
      }

      chatsScanned++;
      onProgress?.(`📱 סורק: ${chatName} (${messages.length} הודעות)`);

      // ── Step 1: Text Analysis ──
      // First batch gets empty context (we're scanning the full window)
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE);
        const contextForBatch = messages.slice(Math.max(0, i - 15), i);

        const { findings, cost } = await analyzeBatch(
          childName,
          chatName,
          chatJid.endsWith("@g.us"),
          contextForBatch,
          batch,
          childAge,
          childGender
        );

        totalCost += cost;
        totalScanned += batch.length;

        for (const finding of findings) {
          const alert: Alert = {
            ...finding,
            chatJid,
            chatName,
          };
          allAlerts.push(alert);
          recordRiskFlagForAccount(accountId, alert, scanId);

          queries.createAlert.run(
            accountId, scanId, alert.severity, alert.category,
            alert.chatJid, alert.chatName, alert.summary,
            alert.recommendation, alert.confidence,
            null
          );
        }
      }

      // ── Step 2: Media Analysis (per chat) — paid plans only ──
      const chatMedia = queries.getUnanalyzedMediaForChat.all(accountId, chatJid, 20) as any[];
      if (chatMedia.length > 0) {
        if (isFreePlan) {
          skippedMediaCount += chatMedia.length;
        } else {
          onProgress?.(`🖼️ בודק ${chatMedia.length} קבצי מדיה ב-${chatName}`);
          try {
            const mediaResult = await analyzeChatMedia(accountId, chatJid, 20, onProgress);
            totalCost += mediaResult.cost;

            for (const flag of mediaResult.flags) {
              const mediaAlert: Alert = {
                severity: flag.severity,
                category: flag.category,
                chatJid: flag.chatJid,
                chatName: flag.chatName || chatName,
                summary: flag.detail,
                recommendation: getMediaRecommendation(flag.category, flag.severity),
                confidence: flag.confidence,
              };
              allAlerts.push(mediaAlert);
              recordRiskFlagForAccount(accountId, mediaAlert, scanId);

              queries.createAlert.run(
                accountId, scanId, mediaAlert.severity, mediaAlert.category,
                mediaAlert.chatJid, mediaAlert.chatName, mediaAlert.summary,
                mediaAlert.recommendation, mediaAlert.confidence,
                null
              );
            }
          } catch {}
        }
      }

      // ── Step 3: Update cursor ──
      queries.upsertCursor.run(accountId, chatJid, lastMsg.timestamp, lastMsg.msg_id, messages.length);

      // ── Step 4: Cleanup — delete processed data, keep only context for next scan ──
      cleanupChatData(accountId, chatJid);
    }

    const totalMessages = chats.reduce((s, c) => s + c.msg_count, 0);

    // ── New Contacts Detection ──
    onProgress?.(`👤 בודק אנשי קשר חדשים...`);
    const lastScan = queries.getScanHistory.all(accountId, 2) as any[];
    const prevScanTime = lastScan.length > 1 ? lastScan[1].started_at : 0;

    const rawNewContacts = queries.getNewContactsSince.all(accountId, prevScanTime) as any[];
    const newContactInfos: NewContactInfo[] = [];

    for (const contact of rawNewContacts) {
      // Skip safe contacts
      if (queries.isSafeContact.get(accountId, contact.jid)) continue;

      // Get their messages to assess the conversation
      const msgs = queries.getMessagesSince.all(accountId, contact.jid, 0) as MessageRow[];
      let assessment: string | null = null;

      if (msgs.length >= 3) {
        try {
          const assessResult = await assessNewContact(
            childName, contact.name, msgs.slice(-20), childAge, childGender
          );
          assessment = assessResult.assessment;
          totalCost += assessResult.cost;
        } catch {}
      }

      newContactInfos.push({
        jid: contact.jid,
        name: contact.name || contact.jid.split("@")[0],
        messageCount: contact.message_count,
        firstSeen: contact.first_seen,
        assessment,
      });
    }

    // ── Suspicious Groups (extract from alerts — include group name) ──
    const suspiciousGroups: SuspiciousGroup[] = [];
    const seenGroups = new Set<string>();
    for (const alert of allAlerts) {
      if (alert.chatJid.endsWith("@g.us") && !seenGroups.has(alert.chatJid)) {
        seenGroups.add(alert.chatJid);
        suspiciousGroups.push({
          jid: alert.chatJid,
          name: alert.chatName,
          category: alert.category,
          reason: alert.summary,
        });
      }
    }

    // Update scan record
    queries.updateScan.run(
      "completed", totalScanned, totalMessages,
      chatsScanned, chatsSkipped, allAlerts.length, totalCost, null, scanId
    );

    // Increment scan count for topic rotation
    queries.incrementScanCount.run(accountId);

    // ── Free plan: disconnect WhatsApp link after scan (security) ──
    if (isFreePlan) {
      onProgress?.("🔒 תוכנית חינם — מנתק את הקישור לוואטסאפ לאבטחה");
      try { await logoutAccount(accountId); } catch {}
    }

    onProgress?.(`✅ סריקה הושלמה: ${totalScanned} הודעות, ${allAlerts.length} ממצאים, ${newContactInfos.length} אנשי קשר חדשים`);

    return {
      scanId, accountId,
      messagesScanned: totalScanned,
      messagesNew: totalMessages,
      chatsScanned, chatsSkipped,
      alerts: allAlerts,
      newContacts: newContactInfos,
      suspiciousGroups,
      skippedMedia: skippedMediaCount,
      cost: totalCost,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    queries.updateScan.run("failed", 0, 0, 0, 0, 0, 0, error, scanId);
    throw err;
  }
}

// ── Plan Check ──

/**
 * Check if the account's parent is on the free plan.
 */
function checkIfFreePlan(accountId: string): boolean {
  const parents = getParentsForChild(accountId);
  if (parents.length === 0) return true; // no parent linked → treat as free

  // Check any parent's subscription — if any is paid, not free
  for (const parent of parents) {
    const sub = queries.getSubscription.get(parent.id) as any;
    if (sub && sub.plan !== "free" && sub.status === "active") return false;
  }
  return true;
}

// ── Risk Flag Recording ──

const SEVERITY_ORDER: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Compute risk level from severity + confidence.
 */
function computeRiskLevel(severity: string, confidence: number): string {
  const base = SEVERITY_ORDER[severity] || 0;
  if (base >= 4 || (base >= 3 && confidence >= 0.7)) return "critical";
  if (base >= 3 || (base >= 2 && confidence >= 0.7)) return "high";
  if (base >= 2) return "medium";
  return "low";
}

/**
 * Record a risk flag for a chat + category.
 * 1. Upserts the aggregate flag (hit_count grows, risk_level only goes up)
 * 2. Inserts an individual risk event with timestamp for full history
 */
function recordRiskFlagForAccount(accountId: string, alert: Alert, scanId?: number): void {
  const riskLevel = computeRiskLevel(alert.severity, alert.confidence);

  // Aggregate flag
  queries.upsertRiskFlag.run(
    accountId,
    alert.chatJid,
    alert.category,
    riskLevel,
    alert.severity,
    alert.confidence
  );

  // Individual event log
  queries.insertRiskEvent.run(
    accountId,
    alert.chatJid,
    alert.chatName,
    alert.category,
    alert.severity,
    alert.confidence,
    alert.summary,
    scanId || null
  );
}

// ── Chat Cleanup (Privacy) ──

/**
 * After processing a chat: delete old messages and media files.
 * Keep only CONTEXT_KEEP recent messages for the next scan's context window.
 */
function cleanupChatData(accountId: string, chatJid: string): void {
  try {
    // Get media file paths before deleting messages
    const mediaFiles = queries.getMediaFilesForChat.all(accountId, chatJid) as { media_path: string }[];

    // Delete old messages, keep only recent for context
    queries.deleteMessagesKeepRecent.run(
      accountId, chatJid,
      accountId, chatJid,
      CONTEXT_KEEP
    );

    // Delete media files from disk (only for messages that were deleted)
    // Re-check which media files still exist in DB
    const remainingMedia = new Set(
      (queries.getMediaFilesForChat.all(accountId, chatJid) as { media_path: string }[])
        .map((m) => m.media_path)
    );

    for (const file of mediaFiles) {
      if (file.media_path && !remainingMedia.has(file.media_path)) {
        try { fs.unlinkSync(file.media_path); } catch {}
      }
    }
  } catch (err) {
    console.error(`[${accountId}] Cleanup failed for ${chatJid}:`, err);
  }
}

// ── New Contact Assessment ──

async function assessNewContact(
  childName: string,
  contactName: string,
  messages: MessageRow[],
  childAge: number | null,
  childGender: string | null
): Promise<{ assessment: string; cost: number }> {
  const client = getClient();
  const ageLabel = childAge ? `בן/בת ${childAge}` : "";

  const chatLog = messages.map((m) => {
    const sender = m.from_child ? `[${childName}]` : `[${contactName}]`;
    return `${sender}: ${m.body}`;
  }).join("\n");

  const prompt = `אתה מנתח שיחות של ילדים. ${childName} ${ageLabel} התחיל/ה לדבר עם איש קשר חדש בשם "${contactName}".

הנה השיחה עד כה:
${chatLog}

נתח בקצרה (2-3 משפטים בעברית):
1. מי כנראה איש הקשר הזה (ילד באותו גיל? מבוגר? לא ברור?)
2. האם יש משהו שדורש תשומת לב?
3. הערכה כללית: תקין / כדאי לעקוב / מדאיג

אל תציין שמות. ענה רק טקסט, לא JSON.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL_FAST,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    });

    const usage = response.usage;
    const cost = ((usage?.prompt_tokens || 0) / 1_000_000) * 0.075 +
                 ((usage?.completion_tokens || 0) / 1_000_000) * 0.3;

    return {
      assessment: response.choices[0]?.message?.content?.trim() || "לא ניתן להעריך",
      cost,
    };
  } catch {
    return { assessment: null as any, cost: 0 };
  }
}

// ── AI Analysis ──

async function analyzeBatch(
  childName: string,
  chatName: string,
  isGroup: boolean,
  contextMessages: MessageRow[],
  newMessages: MessageRow[],
  childAge: number | null,
  childGender: string | null
): Promise<{ findings: Omit<Alert, "chatJid" | "chatName">[]; cost: number }> {
  const client = getClient();

  // Format messages
  const contextText = contextMessages.length > 0
    ? `── הקשר (${contextMessages.length} הודעות קודמות) ──\n` +
      contextMessages.map((m) => formatMessage(m, childName)).join("\n") +
      "\n\n"
    : "";

  const newText = `── הודעות חדשות לסריקה (${newMessages.length}) ──\n` +
    newMessages.map((m) => formatMessage(m, childName)).join("\n");

  const genderLabel = childGender === "girl" ? "ילדה" : "ילד";
  const ageLabel = childAge ? `${genderLabel} בן/בת ${childAge}` : genderLabel;
  const userPrompt = `${isGroup ? `קבוצה: "${chatName}"` : `שיחה פרטית עם: ${chatName}`}\n${ageLabel}, שם: ${childName}\n\n${contextText}${newText}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL_FAST,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(childAge, childGender) },
        { role: "user", content: userPrompt },
      ],
    });

    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    // Gemini Flash Lite pricing
    const cost = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const findings = (parsed.findings || []).filter((f: any) => f.confidence >= 0.5);

    // If findings with medium+ confidence, run deep analysis
    const needsDeep = findings.some((f: any) => f.confidence >= 0.6 && ["critical", "high"].includes(f.severity));

    if (needsDeep) {
      const deepResult = await deepAnalysis(client, childName, chatName, isGroup, contextMessages, newMessages, findings, childAge, childGender);
      return { findings: deepResult.findings, cost: cost + deepResult.cost };
    }

    return { findings, cost };
  } catch (err) {
    console.error("AI analysis failed:", err);
    return { findings: [], cost: 0 };
  }
}

async function deepAnalysis(
  client: OpenAI,
  childName: string,
  chatName: string,
  isGroup: boolean,
  contextMessages: MessageRow[],
  newMessages: MessageRow[],
  initialFindings: any[],
  childAge: number | null,
  childGender: string | null
): Promise<{ findings: Omit<Alert, "chatJid" | "chatName">[]; cost: number }> {
  const contextText = contextMessages.map((m) => formatMessage(m, childName)).join("\n");
  const newText = newMessages.map((m) => formatMessage(m, childName)).join("\n");

  const userPrompt = `ניתוח מעמיק:

${isGroup ? `קבוצה: "${chatName}"` : `שיחה פרטית עם: ${chatName}`}
שם הילד: ${childName}

ממצאים ראשוניים:
${JSON.stringify(initialFindings, null, 2)}

── הקשר ──
${contextText}

── הודעות חדשות ──
${newText}

אנא בצע ניתוח מעמיק. בדוק:
1. האם הממצאים הראשוניים מדויקים? ייתכן שזה false positive.
2. האם יש הקשר שמשנה את המשמעות?
3. מהי רמת הסיכון האמיתית?
4. מה ההמלצה המדויקת להורה?

ענה ב-JSON כמו קודם.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL_DEEP,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(childAge, childGender) },
        { role: "user", content: userPrompt },
      ],
    });

    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    const cost = (inputTokens / 1_000_000) * 0.1 + (outputTokens / 1_000_000) * 0.4;

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const findings = (parsed.findings || []).filter((f: any) => f.confidence >= 0.5);

    return { findings, cost };
  } catch (err) {
    console.error("Deep analysis failed:", err);
    return { findings: initialFindings, cost: 0 };
  }
}

function formatMessage(msg: MessageRow, childName: string): string {
  const time = new Date(msg.timestamp * 1000).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const sender = msg.from_child ? `[${childName}]` : `[${msg.sender_name || "משתתף"}]`;
  // Include transcription if available
  const text = msg.transcription
    ? `${msg.body} | תמלול: "${msg.transcription}"`
    : msg.body;
  return `${time} ${sender}: ${text}`;
}

// ── Parent-Facing Report (Privacy-Safe) ──

interface ParentReport {
  status: "clean" | "attention" | "urgent";
  statusMessage: string;
  groupConcerns: number; // number of groups worth discussing
  findings: {
    severity: string;
    category: string;
    chatName: string;
    isGroup: boolean;
    summary: string;
    recommendation: string;
  }[];
  newContacts: {
    name: string;
    messageCount: number;
    assessment: string | null;
  }[];
  suspiciousGroups: {
    name: string;
    category: string;
    reason: string;
  }[];
  riskProfile: {
    category: string;
    riskLevel: string;
    hitCount: number;
    lastDetected: number;
    recentEvents: { date: number; severity: string; summary: string | null; chatName: string | null; isGroup: boolean }[];
  }[];
  skippedMedia: number;
  scanStats: {
    messagesScanned: number;
    chatsScanned: number;
    durationMs: number;
  };
  kidTipsMessage: string | null;
  conversationTopic: string | null;
}

export function buildParentReport(
  result: ScanResult,
  childAge?: number | null,
  childGender?: string | null,
  childName?: string | null,
  scanCount?: number
): ParentReport {
  const findings = result.alerts.map((a) => ({
    severity: a.severity,
    category: a.category,
    chatName: a.chatName,
    isGroup: a.chatJid.endsWith("@g.us"),
    summary: a.summary,
    recommendation: a.recommendation,
  }));

  const groupConcerns = new Set(
    result.alerts.filter((a) => a.chatJid.endsWith("@g.us")).map((a) => a.chatJid)
  ).size;

  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasHigh = findings.some((f) => f.severity === "high");

  let status: ParentReport["status"];
  let statusMessage: string;

  if (hasCritical) {
    status = "urgent";
    statusMessage = "🔴 זוהו ממצאים דחופים שדורשים תשומת לב מיידית";
  } else if (hasHigh || findings.length > 0) {
    status = "attention";
    statusMessage = `🟡 זוהו ${findings.length} ממצאים שכדאי לשים לב אליהם`;
  } else {
    status = "clean";
    statusMessage = "🟢 לא זוהו ממצאים חריגים — הכל נראה תקין";
  }

  // Generate kid tips based on scan findings
  const scanCategories = result.alerts.map((a) => a.category);
  const tips = getTipsForChild(childAge || null, childGender || null, scanCategories, 3);
  const kidTipsMessage = tips.length > 0
    ? formatKidTipsWhatsApp(tips, childName || undefined)
    : null;

  // New contacts
  const newContacts = result.newContacts.map((c) => ({
    name: c.name,
    messageCount: c.messageCount,
    assessment: c.assessment,
  }));

  // Suspicious groups — include name + reason for parent
  const suspiciousGroups = result.suspiciousGroups.map((g) => ({
    name: g.name,
    category: g.category,
    reason: g.reason,
  }));

  // Build cumulative risk profile from DB
  const riskFlags = queries.getRiskFlagsForAccount.all(result.accountId) as any[];
  // Aggregate by category (across all chats)
  const riskByCategory = new Map<string, { riskLevel: string; hitCount: number; lastDetected: number }>();
  for (const flag of riskFlags) {
    const existing = riskByCategory.get(flag.category);
    if (!existing || SEVERITY_ORDER[flag.risk_level] > SEVERITY_ORDER[existing.riskLevel]) {
      riskByCategory.set(flag.category, {
        riskLevel: flag.risk_level,
        hitCount: (existing?.hitCount || 0) + flag.hit_count,
        lastDetected: Math.max(existing?.lastDetected || 0, flag.last_detected),
      });
    } else {
      existing.hitCount += flag.hit_count;
      existing.lastDetected = Math.max(existing.lastDetected, flag.last_detected);
    }
  }

  const riskProfile = Array.from(riskByCategory.entries())
    .map(([category, data]) => {
      // Fetch last 5 events for this category
      const events = queries.getRiskEventsForCategory.all(result.accountId, category, 5) as any[];
      return {
        category,
        ...data,
        recentEvents: events.map((e: any) => ({
          date: e.detected_at,
          severity: e.severity,
          summary: e.summary,
          chatName: e.chat_name || null,
          isGroup: e.chat_jid?.endsWith("@g.us") || false,
        })),
      };
    })
    .sort((a, b) => SEVERITY_ORDER[b.riskLevel] - SEVERITY_ORDER[a.riskLevel]);

  // Adjust status if new contacts found (even if no alerts)
  if (status === "clean" && newContacts.length > 0) {
    status = "attention";
    statusMessage = `🟡 לא זוהו ממצאים, אבל יש ${newContacts.length} ${newContacts.length === 1 ? "איש קשר חדש" : "אנשי קשר חדשים"}`;
  }

  return {
    status,
    statusMessage,
    groupConcerns,
    findings,
    newContacts,
    suspiciousGroups,
    riskProfile,
    skippedMedia: result.skippedMedia,
    scanStats: {
      messagesScanned: result.messagesScanned,
      chatsScanned: result.chatsScanned,
      durationMs: result.durationMs,
    },
    kidTipsMessage,
    conversationTopic: formatTopicWhatsApp(
      getNextTopic(childAge || null, childGender || null, scanCount || 0),
      childName || undefined
    ),
  };
}

/**
 * Format parent report as WhatsApp message (Hebrew).
 * Suspicious groups DO include the group name + general reason.
 * No message content or quotes exposed.
 */
export function formatParentWhatsApp(report: ParentReport, portalUrl?: string): string {
  const lines: string[] = [];

  lines.push(`📊 *דוח סריקה*`);
  lines.push(report.statusMessage);
  lines.push("");

  // ── Suspicious Groups (with names) ──
  if (report.suspiciousGroups.length > 0) {
    lines.push("*⚠️ קבוצות שדורשות תשומת לב:*");
    for (const g of report.suspiciousGroups) {
      lines.push(`• *${g.name}* — ${categoryLabel(g.category)}: ${g.reason}`);
    }
    lines.push("");
  }

  // ── Findings ──
  if (report.findings.length > 0) {
    for (const f of report.findings) {
      const icon = f.severity === "critical" ? "🔴" : f.severity === "high" ? "🟠" : "🟡";
      const where = f.isGroup ? `קבוצה: ${f.chatName}` : `צ׳אט עם: ${f.chatName}`;
      lines.push(`${icon} *${categoryLabel(f.category)}* — ${where}`);
      lines.push(f.summary);
      lines.push(`💡 ${f.recommendation}`);
      lines.push("");
    }
  }

  // ── New Contacts ──
  if (report.newContacts.length > 0) {
    lines.push("*👤 אנשי קשר חדשים:*");
    for (const c of report.newContacts) {
      const msgLabel = c.messageCount === 1 ? "הודעה אחת" : `${c.messageCount} הודעות`;
      lines.push(`• *${c.name}* (${msgLabel})`);
      if (c.assessment) {
        lines.push(`  ${c.assessment}`);
      }
    }
    lines.push("");
  }

  // ── Clean scan ──
  if (report.findings.length === 0 && report.newContacts.length === 0 && report.suspiciousGroups.length === 0) {
    lines.push("סרקנו את ההודעות האחרונות ולא נמצא שום דבר מדאיג. 👍");
  }

  // ── Risk Profile (cumulative) ──
  const activeRisks = report.riskProfile.filter((r) => r.riskLevel !== "low");
  if (activeRisks.length > 0) {
    lines.push("");
    lines.push("*🛡️ פרופיל סיכון מצטבר:*");
    for (const r of activeRisks) {
      const icon = r.riskLevel === "critical" ? "🔴" : r.riskLevel === "high" ? "🟠" : "🟡";
      const times = r.hitCount === 1 ? "פעם אחת" : `${r.hitCount} פעמים`;
      lines.push(`${icon} *${categoryLabel(r.category)}* — ${times}`);
      // Show recent events with date + chat/group name
      for (const ev of r.recentEvents.slice(0, 3)) {
        const date = new Date(ev.date * 1000).toLocaleDateString("he-IL", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
        const prefix = ev.isGroup ? "קבוצה" : "צ׳אט עם";
        const where = ev.chatName ? ` — ${prefix}: ${ev.chatName}` : "";
        lines.push(`   📅 ${date}${where}`);
      }
    }
  }

  // ── Conversation topic (always) ──
  if (report.conversationTopic) {
    lines.push("");
    lines.push("───────────────");
    lines.push("");
    lines.push(report.conversationTopic);
  }

  lines.push("");
  lines.push(`_${report.scanStats.messagesScanned} הודעות נסרקו ב-${Math.round(report.scanStats.durationMs / 1000)} שניות_`);

  if (report.skippedMedia > 0) {
    lines.push("");
    lines.push(`📎 *נמצאו ${report.skippedMedia} קבצי מדיה שלא נסרקו:*`);
    lines.push("תמונות, סרטונים והודעות קוליות יכולים להכיל תוכן מדאיג שלא ניתן לזהות מטקסט בלבד.");
    lines.push("");
    lines.push("🔍 *רוצה לסרוק גם מדיה?*");
    lines.push("");
    lines.push("📅 *בסיס* — ₪19/חו׳ | סריקה שבועית + מדיה");
    lines.push("⚡ *מתקדמת* — ₪29/חו׳ | סריקה יומית + מדיה");
    lines.push("_מחירים בתשלום שנתי. +₪5/חו׳ בתשלום חודשי._");
    lines.push("_30% הנחה מהילד השני._");
    if (portalUrl) {
      lines.push("");
      lines.push(`👉 לשדרוג: ${portalUrl}`);
    }
  } else if (portalUrl) {
    lines.push("");
    lines.push(`📚 מדריכים ותשלום: ${portalUrl}`);
  }

  return lines.join("\n");
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    exclusion: "הדרה חברתית",
    suicidal: "מחשבות אובדניות",
    grooming: "טיפוח מיני",
    sexual: "תוכן מיני",
    drugs: "סמים/אלכוהול",
    bullying: "בריונות",
    violence: "אלימות",
    pressure: "לחץ חברתי",
    language: "שפה פוגענית",
    self_harm: "פגיעה עצמית",
    weapon: "נשק",
    threat: "איום",
    personal_info: "מידע אישי חשוף",
  };
  return labels[cat] || cat;
}

function getMediaRecommendation(category: string, severity: string): string {
  const recommendations: Record<string, string> = {
    sexual: "זוהה תוכן מיני. מומלץ לשוחח עם הילד על תוכן לא הולם ולבדוק עם מי השיחה.",
    drugs: "זוהו סימנים לסמים/אלכוהול בתמונה. מומלץ לברר את ההקשר עם הילד.",
    self_harm: "זוהו סימנים לפגיעה עצמית. זה דורש תשומת לב מיידית. מומלץ לפנות לאיש מקצוע.",
    violence: "זוהה תוכן אלים. מומלץ לשוחח עם הילד ולהבין את ההקשר.",
    weapon: "זוהה נשק בתמונה. מומלץ לברר מיידית את ההקשר.",
    threat: "זוהתה הודעה מאיימת. מומלץ לשוחח עם הילד ולשקול דיווח.",
    personal_info: "מידע אישי חשוף (כתובת/טלפון). מומלץ להזכיר לילד לא לשתף מידע אישי.",
  };
  return recommendations[category] || "מומלץ לבדוק את התוכן ולשוחח עם הילד.";
}
