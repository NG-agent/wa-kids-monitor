/**
 * Shomer WhatsApp Bot — handles incoming messages from parents & kids
 * 
 * One WhatsApp number serves two audiences:
 * 1. Parents: registration, reports, management
 * 2. Kids: safe channel for help with bullying, grooming, etc.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import fs from "fs";
import { queries } from "./db";

const BOT_SESSION_DIR = path.join(process.cwd(), "data", "wa-bot-session");
const BOT_NUMBER = process.env.SHOMER_BOT_NUMBER || ""; // e.g. "972501234567"

// ─── Types ───

interface BotState {
  socket: WASocket | null;
  status: "disconnected" | "connecting" | "qr" | "ready";
  qrCode?: string;
}

interface ConversationContext {
  phone: string;
  role: "parent" | "kid" | "unknown";
  state: string; // FSM state
  data: Record<string, any>;
  lastActivity: number;
}

// In-memory conversation state (per phone number)
const conversations = new Map<string, ConversationContext>();

// ─── Kid Support Messages ───

const KID_INTRO_MESSAGE = (childName: string, gender: "boy" | "girl" | null) => {
  const suffix = gender === "girl" ? "ה" : "";
  return `היי ${childName}! 👋

אני שומר 🛡️ — חבר דיגיטלי שתמיד כאן.

אם פעם תרגיש${suffix} שמשהו מפריע לך, או שקורה משהו שלא נעים — אפשר לכתוב לי.
אני לא מורה, לא הורה, ולא אגיד לאף אחד. סתם מישהו שאפשר לדבר איתו 💙

אפשר לדבר על הכל — חברים, בית ספר, דברים ברשת, או סתם לשאול שאלות.

רוצה לדבר? פשוט כתוב 😊`;
};

const KID_MENU = `על מה בא לך לדבר? 😊

1️⃣ קורים דברים לא נעימים בכיתה
2️⃣ מישהו מתנהג אליי לא בסדר
3️⃣ קיבלתי הודעה מוזרה
4️⃣ קורה משהו לחבר/ה שלי
5️⃣ סתם צריך מישהו לדבר איתו

או פשוט ספר מה קורה — אני מקשיב 💙`;

// ─── Kid Response Templates ───

const KID_RESPONSES: Record<string, string> = {
  exclusion: `אוף, זה ממש לא פשוט 😔

קודם כל — אתה לא לבד. הרבה ילדים עוברים את זה, גם אם זה לא נראה ככה.

ויש משהו חשוב שאני רוצה שתדע: חרם אומר משהו על מי שעושה אותו, לא עליך. אתה בסדר גמור כמו שאתה.

💡 שאלה — יש מישהו בכיתה, אפילו אחד, שאתה מרגיש איתו בנוח? לפעמים חבר אחד טוב שווה יותר מקבוצה שלמה.

ספר לי עוד — מה בדיוק קורה?`,

  bullying: `לא נעים לשמוע 😟 אף אחד לא צריך לסבול את זה.

אני רוצה להבין — מה קורה בדיוק? זה מישהו ספציפי? זה קורה בבית הספר, באינטרנט, או בשניהם?

💡 דבר אחד שחשוב לזכור: ברגע שאתה מדבר על זה (כמו שאתה עושה עכשיו) — אתה כבר עושה צעד חכם. הרבה ילדים שותקים, ואתה לא.

ספר לי עוד, ונחשוב ביחד מה אפשר לעשות 💪`,

  sexual: `טוב שאתה מדבר על זה — ברצינות, זה דורש אומץ 💪

כלל חשוב: אף אחד לא רשאי לבקש ממך תמונות שאתה לא מרגיש בנוח איתן. גם אם זה חבר. גם אם "כולם עושים את זה". אתה לא חייב כלום.

אם כבר קרה משהו — שום דבר לא נשבר, אפשר לטפל בזה.

ספר לי מה קרה ונחשוב ביחד על הצעד הבא, בלי לחץ 💙`,

  friend_distress: `וואו, אתה חבר ממש טוב שאכפת לך 💙

תספר לי — מה קורה עם החבר/ה שלך? מה גורם לך לדאוג?

💡 לפעמים הדבר הכי חשוב שאפשר לעשות בשביל חבר הוא פשוט להיות שם ולהגיד "אני כאן בשבילך". זה כבר עוזר יותר ממה שאתה חושב.

ספר לי, ונחשוב ביחד מה אפשר לעשות 😊`,

  other: `בטח, אני כאן 😊

ספר לי מה עובר עליך — אפשר על הכל.

אם קשה לך למצוא מילים, אפשר גם:
• פשוט לתאר מה הרגשת
• או מה קרה בקצרה

בלי שיפוט, בלי לחץ 💙`,
};

// ─── Parent Registration Flow ───

const PARENT_WELCOME = `🛡️ שלום! ברוכים הבאים לשומר.

שומר מנטר את שיחות הוואטסאפ של ילדך ומזהה תכנים מסוכנים כמו בריונות, הטרדה, סמים ועוד — בפרטיות מלאה.

מה תרצו לעשות?

1️⃣ הרשמה — התחלת ניטור
2️⃣ איך זה עובד?
3️⃣ מחירים
4️⃣ כבר רשום — כניסה לפורטל`;

const PARENT_HOW_IT_WORKS = `📱 איך שומר עובד?

1️⃣ מקשרים את הוואטסאפ של הילד/ה (סריקת QR)
2️⃣ המערכת סורקת שיחות עם AI מתקדם
3️⃣ מקבלים דוח עם ממצאים + טיפים לשיחה

🔍 מה אנחנו מזהים:
• חרם חברתי והדרה
• בריונות ואיומים
• הטרדה מינית וטיפוח
• שימוש בסמים ואלכוהול
• מחשבות אובדניות
• קישורים מסוכנים ושיתוף מיקום

🔒 ההודעות לא נשמרות — רק סיכומי AI.
👶 הילד מקבל גם ערוץ תמיכה אנונימי.

רוצים להתחיל? כתבו *הרשמה*`;

const PARENT_PRICING = `💰 תוכניות שומר:

🆓 *חינם*
• סריקה ידנית פעם בחודש
• טקסט בלבד (ללא מדיה)
• הקישור מתנתק אחרי סריקה

📦 *בסיסי — ₪19/חודש*
• סריקה אוטומטית שבועית
• כולל תמונות וסרטונים
• הקישור נשאר פעיל

⭐ *מתקדם — ₪29/חודש*
• סריקה אוטומטית יומית
• כולל תמונות וסרטונים
• התראות בזמן אמת

💡 מנוי שנתי: חיסכון של 20%
👨‍👩‍👧‍👦 מהילד השני: הנחה של 30%

רוצים להתחיל? כתבו *הרשמה*`;

// ─── Bot Core ───

const botState: BotState = {
  socket: null,
  status: "disconnected",
};

export function getBotState(): BotState {
  return botState;
}

export async function startBot(): Promise<void> {
  if (botState.status === "ready" || botState.status === "connecting") return;

  botState.status = "connecting";
  fs.mkdirSync(BOT_SESSION_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(BOT_SESSION_DIR);
  const logger = pino({ level: "silent" });

  const socket = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["Shomer Bot", "Chrome", "1.0.0"],
  });

  botState.socket = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.status = "qr";
      botState.qrCode = qr;
    }

    if (connection === "open") {
      botState.status = "ready";
      console.log("[shomer-bot] Connected and ready");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        botState.status = "disconnected";
        console.log("[shomer-bot] Logged out");
      } else {
        botState.status = "connecting";
        setTimeout(() => startBot(), 5000);
      }
    }
  });

  // Handle incoming messages
  socket.ev.on("messages.upsert", async (data) => {
    for (const msg of data.messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      const chatJid = msg.key.remoteJid || "";
      if (!chatJid || chatJid.endsWith("@g.us") || chatJid === "status@broadcast") continue;

      const text = msg.message.conversation ||
        msg.message.extendedTextMessage?.text || "";
      if (!text.trim()) continue;

      const phone = chatJid.replace("@s.whatsapp.net", "");
      await handleIncomingMessage(phone, chatJid, text.trim());
    }
  });
}

// ─── Message Handler ───

async function handleIncomingMessage(phone: string, chatJid: string, text: string): Promise<void> {
  const socket = botState.socket;
  if (!socket) return;

  // Determine role: is this a known parent? a known kid?
  let ctx = conversations.get(phone);
  if (!ctx) {
    const role = detectRole(phone);
    ctx = { phone, role, state: "start", data: {}, lastActivity: Date.now() };
    conversations.set(phone, ctx);
  }
  ctx.lastActivity = Date.now();

  let reply: string;

  if (ctx.role === "kid") {
    reply = await handleKidMessage(ctx, text);
  } else if (ctx.role === "parent") {
    reply = await handleParentMessage(ctx, text);
  } else {
    // Unknown — try to detect
    const isParent = !!queries.getParentByPhone?.get(normalizePhone(phone));
    if (isParent) {
      ctx.role = "parent";
      reply = await handleParentMessage(ctx, text);
    } else {
      // Check if it's a kid we monitor
      const isKid = isMonitoredKid(phone);
      if (isKid) {
        ctx.role = "kid";
        reply = await handleKidMessage(ctx, text);
      } else {
        // New user — assume parent (most likely scenario)
        ctx.role = "parent";
        ctx.state = "start";
        reply = PARENT_WELCOME;
      }
    }
  }

  await socket.sendMessage(chatJid, { text: reply });
}

// ─── Kid Message Handler ───

async function handleKidMessage(ctx: ConversationContext, text: string): Promise<string> {
  const lower = text.toLowerCase().trim();

  // Auto-initiated greeting from kid's Baileys connection → send full intro
  if (lower === "היי שומר 👋" || lower === "היי שומר") {
    ctx.state = "intro";
    // Look up kid's name for personalization
    const kidInfo = getKidInfo(ctx.phone);
    return KID_INTRO_MESSAGE(kidInfo?.childName || "👋", kidInfo?.childGender || null);
  }

  // Check for menu/help request
  if (/תפריט|עזרה|menu|help/.test(lower)) {
    ctx.state = "menu";
    return KID_MENU;
  }

  // Check for menu selections
  if (lower === "1" || /חרם|הדרה|מבודד|לא מזמינים/.test(lower)) {
    ctx.state = "topic:exclusion";
    return KID_RESPONSES.exclusion;
  }
  if (lower === "2" || /מציק|מאיים|בריונות|מכה|מפחיד/.test(lower)) {
    ctx.state = "topic:bullying";
    return KID_RESPONSES.bullying;
  }
  if (lower === "3" || /תמונ|עירום|סקסט|נודס|ביקש.*תמונה|שלח.*תמונה/.test(lower)) {
    ctx.state = "topic:sexual";
    return KID_RESPONSES.sexual;
  }
  if (lower === "4" || /חבר.*מצוקה|חברה.*מצוקה|חבר.*רע|לפגוע בעצמ/.test(lower)) {
    ctx.state = "topic:friend_distress";
    return KID_RESPONSES.friend_distress;
  }
  if (lower === "5" || lower === "משהו אחר") {
    ctx.state = "topic:other";
    return KID_RESPONSES.other;
  }

  // If in a topic conversation, provide empathetic AI response
  if (ctx.state.startsWith("topic:")) {
    return await generateKidSupportResponse(ctx, text);
  }

  // Default — show menu
  ctx.state = "menu";
  return KID_MENU;
}

// ─── Parent Message Handler ───

async function handleParentMessage(ctx: ConversationContext, text: string): Promise<string> {
  const lower = text.toLowerCase().trim();

  // Registration flow
  if (lower === "1" || /הרשמה|התחל|רישום/.test(lower)) {
    ctx.state = "register:name";
    return `📝 מעולה! בואו נתחיל.
מה השם שלך?`;
  }

  if (lower === "2" || /איך.*עובד/.test(lower)) {
    return PARENT_HOW_IT_WORKS;
  }

  if (lower === "3" || /מחיר|עלות|כמה/.test(lower)) {
    return PARENT_PRICING;
  }

  if (lower === "4" || /פורטל|כניס|חשבון/.test(lower)) {
    // Generate portal link
    const parent = queries.getParentByPhone?.get(normalizePhone(ctx.phone)) as any;
    if (parent) {
      const token = generatePortalToken(parent.id);
      return `🔗 הנה הקישור לפורטל שלך:\nhttps://shomer.app/portal/${token}\n\nהקישור תקף ל-7 ימים.`;
    }
    return `לא מצאנו חשבון עם המספר הזה. רוצים להירשם? כתבו *הרשמה*`;
  }

  // Registration FSM
  if (ctx.state === "register:name") {
    ctx.data.parentName = text;
    ctx.state = "register:child_name";
    return `שלום ${text}! 👋
מה השם של הילד/ה שתרצו לנטר?`;
  }

  if (ctx.state === "register:child_name") {
    ctx.data.childName = text;
    ctx.state = "register:child_age";
    return `בן/בת כמה ${text}?`;
  }

  if (ctx.state === "register:child_age") {
    const age = parseInt(text);
    if (isNaN(age) || age < 5 || age > 18) {
      return `הגיל חייב להיות בין 5 ל-18. נסו שוב:`;
    }
    ctx.data.childAge = age;
    ctx.state = "register:child_gender";
    return `${ctx.data.childName} בן או בת?

1️⃣ בן
2️⃣ בת`;
  }

  if (ctx.state === "register:child_gender") {
    if (lower === "1" || /בן/.test(lower)) {
      ctx.data.childGender = "boy";
    } else if (lower === "2" || /בת/.test(lower)) {
      ctx.data.childGender = "girl";
    } else {
      return `אנא בחרו: 1 לבן, 2 לבת`;
    }
    ctx.state = "register:tos";
    return `📋 *תנאי שימוש — שומר*

• השירות מנטר וואטסאפ של ילדך באמצעות AI
• אתם מצהירים שאתם הבעלים של המכשיר
• ההודעות לא נשמרות, רק ניתוחי AI
• מומלץ ליידע את הילד/ה
• הילד/ה יקבל ערוץ תמיכה אנונימי

כתבו *מאשר* להמשך או *ביטול* לביטול`;
  }

  if (ctx.state === "register:tos") {
    if (/מאשר|אישור|כן/.test(lower)) {
      ctx.state = "register:connect";
      // Create parent + account in DB
      const parentId = createParentIfNeeded(ctx.phone, ctx.data.parentName);
      const accountId = createChildAccount(parentId, ctx.data);
      ctx.data.accountId = accountId;
      ctx.data.parentId = parentId;

      return `✅ מעולה! החשבון נוצר.

עכשיו צריך לחבר את הוואטסאפ של ${ctx.data.childName}.

🔗 פתחו את הקישור הזה:
https://shomer.app/pair/${accountId}

או סרקו QR מהמחשב:
https://shomer.app/pair/${accountId}?qr=1

(הקישור תקף ל-10 דקות)

אחרי החיבור תקבלו הודעה כאן ✅`;
    }
    if (/ביטול|לא/.test(lower)) {
      ctx.state = "start";
      return `❌ ההרשמה בוטלה. אם תרצו לנסות שוב — כתבו *הרשמה*`;
    }
    return `כתבו *מאשר* להמשך או *ביטול* לביטול`;
  }

  // Default
  if (ctx.state === "start" || !ctx.state) {
    return PARENT_WELCOME;
  }

  return PARENT_WELCOME;
}

// ─── AI-Powered Kid Support ───

async function generateKidSupportResponse(ctx: ConversationContext, text: string): Promise<string> {
  const topic = ctx.state.replace("topic:", "");

  // Track conversation depth
  if (!ctx.data.messageCount) ctx.data.messageCount = 0;
  ctx.data.messageCount++;

  const empathyPhrases = [
    "אני שומע אותך 💙",
    "מבין אותך.",
    "תודה שאתה משתף, זה חשוב.",
    "את לא לבד בזה.",
    "אני כאן.",
  ];
  const randomEmpathy = empathyPhrases[Math.floor(Math.random() * empathyPhrases.length)];

  // Crisis detection — empathy FIRST, then resources
  if (/למות|להתאבד|לסיים|אין טעם|לא רוצה לחיות|לפגוע בעצמ/.test(text)) {
    return `${randomEmpathy}

מה שאתה מרגיש עכשיו זה קשה מאוד, ואני שמח שבחרת לספר למישהו. זה צעד אמיץ.

אתה חשוב. גם אם עכשיו לא מרגיש ככה — אתה חשוב 💙

יש אנשים שיודעים לעזור עם בדיוק מה שאתה מרגיש — אפשר לדבר איתם אנונימית, בלי שאף אחד ידע:
📞 *105* — ער"ן (24/7, חינם, לילדים ונוער)

רוצה לספר לי עוד על מה שאתה מרגיש?`;
  }

  // Escalation patterns — someone asking for explicit content, threats
  if (/מאיים|יהרוג|ישבור|אקדח|סכין|מפחד ללכת/.test(text)) {
    return `${randomEmpathy}

זה נשמע מפחיד, ואני רוצה לוודא שאתה בטוח.

💡 כשמישהו מאיים — הדבר הכי חכם שאפשר לעשות זה לספר למישהו שיכול לעזור. לא כי אתה חלש, אלא כי אתה חכם.

יש מישהו שאתה סומך עליו שיכול לעזור? הורה, מורה, אח גדול?`;
  }

  // After 3+ messages on the same topic — gently suggest talking to someone trusted
  if (ctx.data.messageCount >= 3 && !ctx.data.suggestedTalkToAdult) {
    ctx.data.suggestedTalkToAdult = true;
    return `${randomEmpathy}

אני שמח שאתה מדבר על זה 😊 

יש דבר אחד שאני חושב שיכול לעזור — לספר למישהו שאתה סומך עליו. לא חייב הורה — אפשר גם מורה, יועצת, אח/ות גדול/ה, או כל מבוגר שמרגיש בטוח.

לפעמים ברגע שמבוגר יודע מה קורה — דברים מתחילים להשתנות.

מה אתה חושב? יש מישהו כזה? 💙`;
  }

  // After 5+ messages — mention external resource naturally
  if (ctx.data.messageCount >= 5 && !ctx.data.mentionedResource) {
    ctx.data.mentionedResource = true;
    return `${randomEmpathy}

אגב, אם פעם תרגיש שאתה צריך לדבר עם מישהו אמיתי — יש מקום שנקרא *ער"ן* (105). זה קו לילדים ונוער, אנונימי לגמרי, בחינם, 24 שעות. אפשר גם לכתוב להם בצ'אט.

אבל אני גם כאן, תמיד 😊 ספר עוד.`;
  }

  // Default empathetic continuation
  const continuations = [
    `${randomEmpathy}\n\nספר עוד — אני מקשיב 😊`,
    `${randomEmpathy}\n\nומה עוד קורה? אני כאן.`,
    `${randomEmpathy}\n\nאיך זה גורם לך להרגיש?`,
    `${randomEmpathy}\n\nנשמע מאתגר. מה אתה חושב שהיית רוצה שיקרה?`,
    `${randomEmpathy}\n\nתמשיך, אני איתך 💙`,
  ];

  return continuations[Math.floor(Math.random() * continuations.length)];
}

// ─── Outbound: Initiate kid ↔ bot conversation ───

/**
 * Instead of the bot cold-messaging the kid (spam risk), use the kid's
 * Baileys connection to send a message FROM the kid's WhatsApp TO the
 * Shomer bot number. The bot then replies with the intro message.
 * 
 * WhatsApp sees it as kid-initiated → no spam risk.
 * 
 * @param connector - The kid's active WhatsApp connector (Baileys)
 * @param childName - Used for personalizing the bot's reply
 * @param childGender - For Hebrew gender-aware messages
 */
export async function initiateKidBotConversation(
  connector: { sendMessage: (jid: string, text: string) => Promise<boolean> },
  childName: string,
  childGender: "boy" | "girl" | null
): Promise<boolean> {
  if (!BOT_NUMBER) {
    console.error("[shomer-bot] SHOMER_BOT_NUMBER not set — cannot initiate kid conversation");
    return false;
  }

  const botJid = normalizePhone(BOT_NUMBER) + "@s.whatsapp.net";
  const kidMessage = `היי שומר 👋`; // Simple greeting from kid to bot

  try {
    const sent = await connector.sendMessage(botJid, kidMessage);
    if (!sent) {
      console.error("[shomer-bot] Failed to send kid→bot init message");
      return false;
    }
    console.log(`[shomer-bot] Kid→bot init sent for ${childName}`);
    return true;
  } catch (err) {
    console.error(`[shomer-bot] Kid→bot init failed:`, err);
    return false;
  }
}

/**
 * Direct send from bot to kid — use ONLY as fallback if the Baileys
 * connector approach fails. Higher spam risk.
 */
export async function sendKidIntroMessageDirect(
  kidPhone: string,
  childName: string,
  childGender: "boy" | "girl" | null
): Promise<boolean> {
  const socket = botState.socket;
  if (!socket || botState.status !== "ready") return false;

  const jid = normalizePhone(kidPhone) + "@s.whatsapp.net";
  try {
    await socket.sendMessage(jid, { text: KID_INTRO_MESSAGE(childName, childGender) });
    return true;
  } catch (err) {
    console.error(`[shomer-bot] Failed to send intro to ${kidPhone}:`, err);
    return false;
  }
}

// ─── Outbound: Send report to parent ───

export async function sendParentReport(
  parentPhone: string,
  reportText: string
): Promise<boolean> {
  const socket = botState.socket;
  if (!socket || botState.status !== "ready") return false;

  const jid = normalizePhone(parentPhone) + "@s.whatsapp.net";
  try {
    await socket.sendMessage(jid, { text: reportText });
    return true;
  } catch (err) {
    console.error(`[shomer-bot] Failed to send report to ${parentPhone}:`, err);
    return false;
  }
}

// ─── Helpers ───

function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, "");
  if (p.startsWith("0")) p = "972" + p.slice(1);
  if (p.startsWith("+")) p = p.slice(1);
  return p;
}

function detectRole(phone: string): "parent" | "kid" | "unknown" {
  const normalized = normalizePhone(phone);
  // Check if parent
  const parent = queries.getParentByPhone?.get(normalized) as any;
  if (parent) return "parent";
  // Check if monitored kid
  if (isMonitoredKid(phone)) return "kid";
  return "unknown";
}

function getKidInfo(phone: string): { childName: string; childGender: "boy" | "girl" | null } | null {
  const normalized = normalizePhone(phone);
  try {
    const account = queries.getAccountByPhone?.get(normalized) as any;
    if (account) {
      return { childName: account.child_name || account.name, childGender: account.child_gender || null };
    }
  } catch {}
  return null;
}

function isMonitoredKid(phone: string): boolean {
  // Check if any account has this phone, or if messages exist from this JID
  const normalized = normalizePhone(phone);
  try {
    // Check accounts table phone field
    const account = queries.getAccountByPhone?.get(normalized) as any;
    if (account) return true;
    // Check if we have messages from this JID (child sent messages)
    const jid = normalized + "@s.whatsapp.net";
    const msg = queries.hasMessagesFromJid?.get(jid) as any;
    return !!msg;
  } catch {
    return false;
  }
}

function createParentIfNeeded(phone: string, name: string): string {
  const normalized = normalizePhone(phone);
  const existing = queries.getParentByPhone?.get(normalized) as any;
  if (existing) return existing.id;

  const id = `parent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  queries.createParent?.run(id, normalized, name);
  return id;
}

function createChildAccount(parentId: string, data: Record<string, any>): string {
  const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const scanCode = Math.floor(100000 + Math.random() * 900000).toString();

  // createAccount expects: id, name, child_name, child_birthdate, child_gender
  queries.createAccount?.run(
    id,
    data.childName, // name
    data.childName, // child_name
    null,           // child_birthdate
    data.childGender
  );

  // Link parent to child
  queries.linkParentChild?.run(parentId, id, "primary");

  return id;
}

function generatePortalToken(parentId: string): string {
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  queries.createParentToken?.run(token, parentId, Math.floor(Date.now() / 1000) + 7 * 86400);
  return token;
}

// ─── Cleanup stale conversations (every hour) ───

setInterval(() => {
  const staleMs = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();
  for (const [phone, ctx] of conversations) {
    if (now - ctx.lastActivity > staleMs) {
      conversations.delete(phone);
    }
  }
}, 60 * 60 * 1000);
