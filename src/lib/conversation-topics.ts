/**
 * Rotating conversation topics for parents when scans come back clean.
 * Each topic includes age-appropriate talking points in Hebrew.
 */

export interface ConversationTopic {
  id: string;
  title: string;
  icon: string;
  minAge: number;
  maxAge: number;
  intro: string; // short intro for parent
  talkingPoints: string[]; // what to ask/say to the child
}

const TOPICS: ConversationTopic[] = [
  // ── Privacy & Digital Footprint ──
  {
    id: "digital-footprint",
    title: "טביעת רגל דיגיטלית",
    icon: "👣",
    minAge: 8, maxAge: 18,
    intro: "הילד/ה לא בהכרח מבין/ה שכל מה שנשלח באינטרנט נשאר שם. שיחה קצרה על זה יכולה לעשות הבדל.",
    talkingPoints: [
      "האם ידעת שכל תמונה או הודעה שנשלחת אפשר לצלם מסך? גם אם מוחקים.",
      "מה היית מרגיש/ה אם הודעה שלך הופצה לכל בית הספר?",
      "בוא/י נבדוק יחד את הגדרות הפרטיות בוואטסאפ שלך.",
    ],
  },
  {
    id: "online-friends",
    title: "חברים באינטרנט",
    icon: "🌐",
    minAge: 8, maxAge: 14,
    intro: "ילדים לפעמים מרגישים שאנשים שהם מכירים רק אונליין הם 'חברים אמיתיים'. חשוב לדבר על ההבדל.",
    talkingPoints: [
      "ספר/י לי על החברים שלך בוואטסאפ — האם יש מישהו שלא פגשת פנים אל פנים?",
      "מה היית עושה אם מישהו שלא מכיר/ה מבקש להיפגש?",
      "האם קרה שמישהו ביקש ממך לשמור סוד מהורים? מה עשית?",
    ],
  },
  {
    id: "online-friends-teen",
    title: "חברויות ברשת",
    icon: "🌐",
    minAge: 14, maxAge: 18,
    intro: "נוער מכיר אנשים חדשים ברשת כל הזמן. זה טבעי — אבל כדאי לוודא שהם יודעים לזהות סימנים מדאיגים.",
    talkingPoints: [
      "האם יש אנשים שאתה מדבר/ת איתם באונליין שלא הכרת פנים אל פנים?",
      "מה לדעתך סימנים שמישהו ברשת הוא לא מי שהוא טוען שהוא?",
      "אם משהו ירגיש לא נוח — אתה יודע/ת שאפשר תמיד לדבר איתנו, בלי שיפוט.",
    ],
  },
  {
    id: "group-dynamics",
    title: "דינמיקה בקבוצות",
    icon: "👥",
    minAge: 9, maxAge: 16,
    intro: "קבוצות וואטסאפ הן המקום שבו רוב הדרמה החברתית קורית. שיחה קצרה על איך מרגישים שם יכולה לחשוף הרבה.",
    talkingPoints: [
      "איך מרגיש בקבוצת הכיתה? יש שם אווירה טובה?",
      "האם קרה שמישהו הוציאו מקבוצה או התעלמו ממנו? מה חשבת על זה?",
      "אתה יודע/ת שמותר לצאת מקבוצה שלא מרגישים בה טוב?",
    ],
  },
  {
    id: "cyberbullying",
    title: "בריונות ברשת",
    icon: "💪",
    minAge: 8, maxAge: 16,
    intro: "70% מהילדים נתקלים בבריונות ברשת. גם אם הילד/ה שלכם לא קורבן — הם בטוח רואים את זה קורה לאחרים.",
    talkingPoints: [
      "האם ראית פעם שמישהו מקבל יחס לא נעים בקבוצה?",
      "מה לדעתך אפשר לעשות כשרואים את זה קורה?",
      "אם זה היה קורה לך — מה היית רוצה שחבר יעשה?",
    ],
  },
  {
    id: "screen-time",
    title: "זמן מסך",
    icon: "⏰",
    minAge: 8, maxAge: 14,
    intro: "ילדים לא תמיד מודעים לכמה זמן הם מבלים עם הטלפון. שיחה בלי האשמות — רק מודעות.",
    talkingPoints: [
      "כמה זמן לדעתך אתה מבלה עם הטלפון ביום?",
      "מה עדיף לך — לדבר עם חברים בוואטסאפ או להיפגש איתם?",
      "בוא/י ננסה יום אחד בלי טלפון אחרי 20:00 — מה דעתך?",
    ],
  },
  {
    id: "passwords-security",
    title: "סיסמאות ואבטחה",
    icon: "🔑",
    minAge: 8, maxAge: 16,
    intro: "ילדים נוטים לשתף סיסמאות עם חברים 'כהוכחת חברות'. חשוב להסביר למה זה מסוכן.",
    talkingPoints: [
      "האם שיתפת פעם סיסמא עם חבר/ה? מה קרה?",
      "סיסמא זה כמו מפתח לבית. היית נותן/ת את המפתח לחבר?",
      "בוא/י נבדוק שיש לך סיסמא חזקה ושונה לכל מקום.",
    ],
  },
  {
    id: "sharing-photos",
    title: "שיתוף תמונות",
    icon: "📸",
    minAge: 10, maxAge: 18,
    intro: "תמונות שנשלחות בוואטסאפ יכולות להגיע לכל מקום. חשוב שהילד/ה יבין/תבין את זה לפני שזה קורה.",
    talkingPoints: [
      "האם שלחת פעם תמונה ואז התחרטת?",
      "'חוק הסבתא': אם לא הייתי מראה את זה לסבתא — לא שולח.",
      "מה היית עושה אם מישהו שלח תמונה שלך בלי רשות?",
    ],
  },
  {
    id: "fake-news",
    title: "מידע מטעה",
    icon: "🤔",
    minAge: 10, maxAge: 18,
    intro: "ילדים מקבלים הודעות 'מועברות' עם מידע שגוי כל הזמן. זה הזדמנות ללמד חשיבה ביקורתית.",
    talkingPoints: [
      "האם קיבלת פעם הודעה מועברת שנראתה מוזרה?",
      "איך אפשר לבדוק אם משהו שמספרים ברשת הוא אמת?",
      "לפני שמעבירים — חושבים: האם זה אמת? האם זה עוזר? האם זה יכול לפגוע?",
    ],
  },
  {
    id: "peer-pressure",
    title: "לחץ חברתי",
    icon: "🫂",
    minAge: 11, maxAge: 18,
    intro: "בקבוצות יש לחץ לא מדובר — לענות מהר, להסכים, להעביר, להשתתף. ילדים צריכים 'כלים לסירוב'.",
    talkingPoints: [
      "האם קרה שהרגשת לחץ לעשות משהו בגלל שכולם עושים?",
      "מה אפשר להגיד כשלא רוצים להשתתף אבל לא רוצים להיראות 'פראייר'?",
      "לפעמים האמיצים הם אלה שאומרים 'לא'. מה דעתך?",
    ],
  },
  {
    id: "substances-awareness",
    title: "סמים ואלכוהול",
    icon: "🚫",
    minAge: 12, maxAge: 18,
    intro: "עדיף לדבר על זה לפני שזה קורה. שיחה פתוחה ובלי איומים היא ההגנה הטובה ביותר.",
    talkingPoints: [
      "האם שמעת על ילדים שמנסים סמים או אלכוהול?",
      "מה היית עושה אם חבר הציע לך לנסות?",
      "אתה יודע/ת שאם משהו קורה — אפשר תמיד לפנות אלינו. לא נכעס, נעזור.",
    ],
  },
  {
    id: "emotional-wellbeing",
    title: "רגשות ואינטרנט",
    icon: "💙",
    minAge: 10, maxAge: 18,
    intro: "רשתות חברתיות משפיעות על הרגשות. חשוב לבדוק עם הילד/ה איך הטלפון גורם להם להרגיש.",
    talkingPoints: [
      "איך אתה מרגיש/ה אחרי שאתה משתמש/ת בטלפון הרבה זמן?",
      "האם קרה שהודעה גרמה לך להרגיש רע?",
      "זה בסדר להרגיש עצוב או כועס — העיקר שמדברים על זה.",
    ],
  },
  {
    id: "asking-for-help",
    title: "לבקש עזרה",
    icon: "🆘",
    minAge: 8, maxAge: 16,
    intro: "ילדים צריכים לדעת שלבקש עזרה זה לא חולשה. וודאו שהילד/ה יודע/ת למי לפנות.",
    talkingPoints: [
      "אם היה קורה משהו שמפחיד אותך ברשת — למי היית פונה?",
      "אתה יודע/ת שאפשר גם להתקשר ל-105 (ער\"ן) אם צריך מישהו לדבר איתו?",
      "אני רוצה שתדע/י — מה שלא קורה, אני בצד שלך. תמיד.",
    ],
  },
  {
    id: "respect-online",
    title: "כבוד ברשת",
    icon: "🤝",
    minAge: 8, maxAge: 16,
    intro: "מאחורי כל הודעה יש בן אדם אמיתי. ילדים לפעמים שוכחים את זה כשכותבים מאחורי מסך.",
    talkingPoints: [
      "האם היית אומר/ת את זה לפנים של מישהו? אם לא — עדיף לא לכתוב.",
      "מה ההבדל בין הומור לפגיעה? איפה הגבול?",
      "איך אתה מרגיש/ה כשמישהו כותב עליך משהו לא נחמד?",
    ],
  },
];

/**
 * Pick the next topic for an account, rotating so the parent gets a different one each scan.
 * Uses scan count to rotate deterministically.
 */
export function getNextTopic(
  childAge: number | null,
  childGender: string | null,
  scanCount: number
): ConversationTopic {
  const age = childAge || 12;

  // Filter by age
  const eligible = TOPICS.filter((t) => age >= t.minAge && age <= t.maxAge);

  // Deterministic rotation based on scan count
  const idx = scanCount % eligible.length;
  const topic = { ...eligible[idx] };

  // Gender-adjust talking points
  if (childGender === "girl") {
    topic.talkingPoints = topic.talkingPoints.map(feminizeTopic);
    topic.intro = feminizeTopic(topic.intro);
  }

  return topic;
}

/**
 * Format topic as part of a WhatsApp report message.
 */
export function formatTopicWhatsApp(topic: ConversationTopic, childName?: string): string {
  const name = childName || "הילד/ה";
  const lines = [
    `${topic.icon} *נושא לשיחה עם ${name}: ${topic.title}*`,
    "",
    topic.intro,
    "",
    "*נקודות לשיחה:*",
    ...topic.talkingPoints.map((p, i) => `${i + 1}. ${p}`),
    "",
    `_💡 שיחה של 5 דקות יכולה לעשות הבדל גדול_`,
  ];
  return lines.join("\n");
}

function feminizeTopic(text: string): string {
  return text
    .replace(/הילד\/ה/g, "הילדה")
    .replace(/ידעת/g, "ידעת")
    .replace(/היית מרגיש\/ה/g, "היית מרגישה")
    .replace(/היית עושה/g, "היית עושה")
    .replace(/היית רוצה/g, "היית רוצה")
    .replace(/היית נותן\/ת/g, "היית נותנת")
    .replace(/היית אומר\/ת/g, "היית אומרת")
    .replace(/אתה מרגיש\/ה/g, "את מרגישה")
    .replace(/אתה משתמש\/ת/g, "את משתמשת")
    .replace(/אתה מדבר\/ת/g, "את מדברת")
    .replace(/אתה יודע\/ת/g, "את יודעת")
    .replace(/שמכיר\/ה/g, "שמכירה")
    .replace(/הרגשת/g, "הרגשת")
    .replace(/מבקש\/ת/g, "מבקשת")
    .replace(/שלחת/g, "שלחת")
    .replace(/קיבלת/g, "קיבלת")
    .replace(/ראית/g, "ראית")
    .replace(/שמעת/g, "שמעת")
    .replace(/ספר\/י/g, "ספרי")
    .replace(/בוא\/י/g, "בואי")
    .replace(/נותן\/ת/g, "נותנת")
    .replace(/יבין\/תבין/g, "תבין")
    .replace(/שתדע\/י/g, "שתדעי")
    .replace(/פונה/g, "פונה")
    .replace(/אומר\/ת/g, "אומרת");
}
