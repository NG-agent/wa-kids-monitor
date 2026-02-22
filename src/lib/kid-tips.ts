/**
 * Kid-facing WhatsApp safety tips.
 * Sent periodically or triggered by scan findings.
 * Age-aware, Hebrew, friendly tone — not preachy.
 */

interface KidTip {
  id: string;
  category: string;
  minAge: number;    // minimum age for this tip
  maxAge: number;    // maximum age
  text: string;      // WhatsApp message text (Hebrew)
  triggerCategories?: string[]; // if set, only show after these scan categories
}

const ALL_TIPS: KidTip[] = [
  // ── Privacy & Safety ──
  {
    id: "location-strangers",
    category: "privacy",
    minAge: 8, maxAge: 18,
    text: "📍 טיפ: שיתוף מיקום בוואטסאפ הוא כלי שימושי — אבל רק עם אנשים שאתה מכיר באמת. אל תשתף מיקום חי עם אנשים שלא פגשת פנים אל פנים.",
  },
  {
    id: "personal-info",
    category: "privacy",
    minAge: 8, maxAge: 18,
    text: "🔒 טיפ: כתובת, מספר טלפון, שם בית ספר — אלה דברים שעדיף לשמור לעצמך. אם מישהו שאתה לא מכיר מבקש את זה, זה סימן לעצור.",
    triggerCategories: ["personal_info", "grooming"],
  },
  {
    id: "photos-think-twice",
    category: "privacy",
    minAge: 10, maxAge: 18,
    text: "📸 טיפ: לפני שאתה שולח תמונה — חשוב שנייה: האם הייתי רוצה שכל הכיתה תראה את זה? אם לא, עדיף לא לשלוח. מה שנשלח באינטרנט, נשאר באינטרנט.",
    triggerCategories: ["sexual"],
  },
  {
    id: "screenshots",
    category: "privacy",
    minAge: 10, maxAge: 18,
    text: "📱 טיפ: כל הודעה שאתה שולח אפשר לצלם מסך ולהפיץ. גם הודעות שנמחקות. שווה לזכור את זה לפני שכותבים משהו.",
  },

  // ── Strangers & Grooming ──
  {
    id: "unknown-contacts",
    category: "strangers",
    minAge: 8, maxAge: 14,
    text: "👤 טיפ: אם מישהו שאתה לא מכיר שולח לך הודעה — אתה לא חייב לענות. אפשר לחסום ולספר להורים. זה לא גסות, זה חכמה.",
    triggerCategories: ["grooming"],
  },
  {
    id: "unknown-contacts-teen",
    category: "strangers",
    minAge: 14, maxAge: 18,
    text: "👤 טיפ: אנשים ברשת לא תמיד מי שהם אומרים שהם. אם מישהו חדש מתחיל לדבר איתך הרבה, מחמיא ומבקש סודיות — זה דגל אדום.",
    triggerCategories: ["grooming"],
  },
  {
    id: "secret-chats",
    category: "strangers",
    minAge: 8, maxAge: 16,
    text: "🤫 טיפ: אם מישהו מבקש ממך לשמור על שיחה בסוד מההורים — זה בדיוק הסוג של דבר שכדאי לספר להורים עליו.",
    triggerCategories: ["grooming"],
  },

  // ── Groups & Social ──
  {
    id: "group-pressure",
    category: "social",
    minAge: 10, maxAge: 18,
    text: "👥 טיפ: בקבוצות לפעמים יש לחץ לעשות דברים שלא בא לך. זכור — אתה לא חייב להסכים לכולם. \"לא\" היא תשובה לגיטימית.",
    triggerCategories: ["pressure"],
  },
  {
    id: "leave-group",
    category: "social",
    minAge: 8, maxAge: 18,
    text: "🚪 טיפ: אם קבוצה גורמת לך להרגיש רע — מותר לצאת. אתה לא צריך סיבה. אפשר גם להשתיק קבוצה בלי לצאת.",
    triggerCategories: ["bullying", "exclusion"],
  },
  {
    id: "dont-forward",
    category: "social",
    minAge: 10, maxAge: 18,
    text: "🔄 טיפ: לפני שאתה מעביר הודעה או תמונה של מישהו — חשוב אם הוא היה רוצה שזה יופץ. מה שמצחיק אותך יכול לפגוע במישהו אחר.",
  },

  // ── Bullying ──
  {
    id: "being-bullied",
    category: "bullying",
    minAge: 8, maxAge: 16,
    text: "💪 טיפ: אם מישהו כותב לך דברים מעליבים או מאיימים — זה לא באשמתך. צלם מסך, חסום, וספר למישהו שאתה סומך עליו.",
    triggerCategories: ["bullying", "violence", "threat"],
  },
  {
    id: "bystander",
    category: "bullying",
    minAge: 10, maxAge: 18,
    text: "👀 טיפ: אם אתה רואה שמישהו מקבל יחס רע בקבוצה — אתה יכול לעשות שינוי. אפילו הודעה פרטית של \"אני פה בשבילך\" עוזרת.",
    triggerCategories: ["bullying", "exclusion"],
  },

  // ── Digital Wellbeing ──
  {
    id: "mute-notifications",
    category: "wellbeing",
    minAge: 10, maxAge: 18,
    text: "🔕 טיפ: אתה יודע שאפשר להשתיק התראות של קבוצות? ככה הטלפון לא מפריע כל הזמן ואתה בודק מתי שמתאים לך.",
  },
  {
    id: "not-always-available",
    category: "wellbeing",
    minAge: 10, maxAge: 18,
    text: "⏰ טיפ: אתה לא חייב לענות על כל הודעה מיד. אנשים שאכפת להם ממך יבינו אם ענית אחרי שעה. אין פה חירום.",
  },
  {
    id: "block-is-ok",
    category: "wellbeing",
    minAge: 8, maxAge: 18,
    text: "🛑 טיפ: חסימה היא כלי. אם מישהו מציק לך — חסום אותו. זה לא דרמה, זה שמירה על עצמך.",
  },

  // ── Drugs/Substances ──
  {
    id: "substances-pressure",
    category: "substances",
    minAge: 12, maxAge: 18,
    text: "🚫 טיפ: אם מישהו מציע לך חומרים דרך וואטסאפ — אתה לא חייב להגיד \"כן\" רק כי כולם עושים את זה. רוב הסיכויים שלא כולם באמת עושים.",
    triggerCategories: ["drugs"],
  },
];

/**
 * Get relevant tips for a child based on age and (optionally) recent scan findings.
 * Returns up to `limit` tips, prioritizing triggered ones.
 */
export function getTipsForChild(
  childAge: number | null,
  childGender: string | null,
  scanCategories?: string[],
  limit = 3,
  excludeIds?: string[]
): KidTip[] {
  const age = childAge || 12; // default
  const excluded = new Set(excludeIds || []);

  // Filter by age
  let eligible = ALL_TIPS.filter(
    (t) => age >= t.minAge && age <= t.maxAge && !excluded.has(t.id)
  );

  // Gender-adjust text (replace אתה/ך)
  if (childGender === "girl") {
    eligible = eligible.map((t) => ({
      ...t,
      text: feminize(t.text),
    }));
  }

  // Split into triggered (matching scan findings) and general
  const triggered: KidTip[] = [];
  const general: KidTip[] = [];

  for (const tip of eligible) {
    if (
      tip.triggerCategories &&
      scanCategories &&
      tip.triggerCategories.some((c) => scanCategories.includes(c))
    ) {
      triggered.push(tip);
    } else if (!tip.triggerCategories) {
      general.push(tip);
    }
  }

  // Prioritize triggered, fill with random general
  const result = [...triggered];
  if (result.length < limit) {
    // Shuffle general
    const shuffled = general.sort(() => Math.random() - 0.5);
    result.push(...shuffled.slice(0, limit - result.length));
  }

  return result.slice(0, limit);
}

/**
 * Format tips as a friendly WhatsApp message to the kid.
 */
export function formatKidTipsWhatsApp(tips: KidTip[], childName?: string): string {
  const greeting = childName ? `היי ${childName}! 👋` : "היי! 👋";
  const lines = [
    greeting,
    "הנה כמה טיפים לשימוש בטוח בוואטסאפ:",
    "",
    ...tips.map((t) => t.text),
    "",
    "יש שאלות? תמיד אפשר לדבר עם ההורים 💙",
  ];
  return lines.join("\n");
}

/**
 * Basic Hebrew feminization for tip text.
 */
function feminize(text: string): string {
  return text
    .replace(/אתה מכיר/g, "את מכירה")
    .replace(/אתה לא מכיר/g, "את לא מכירה")
    .replace(/שאתה/g, "שאת")
    .replace(/אתה יודע/g, "את יודעת")
    .replace(/אתה רואה/g, "את רואה")
    .replace(/אתה לא חייב/g, "את לא חייבת")
    .replace(/אתה חייב/g, "את חייבת")
    .replace(/(?<!\S)אתה(?!\S)/g, "את")
    .replace(/מתאים לך/g, "מתאים לך")
    .replace(/בשבילך/g, "בשבילך")
    .replace(/לעצמך/g, "לעצמך")
    .replace(/סומך/g, "סומכת")
    .replace(/מעביר/g, "מעבירה")
    .replace(/שולח/g, "שולחת")
    .replace(/כותב/g, "כותבת");
}
