"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ChildData {
  id: string;
  childName: string;
  childGender: string;
  status: string;
  scanCode: string;
  lastScanDate: number | null;
  newAlertCount: number;
  hasUrgent: boolean;
  parents: { name: string; phone: string; role: string }[];
}

interface PortalData {
  parent: { id: string; name: string; phone: string };
  children: ChildData[];
  subscription: { plan: string; status: string; paymentLast4: string | null; expiresAt: number | null };
}

const PLANS = [
  {
    id: "free", name: "חינם", icon: "🆓",
    priceYearly: "₪0", priceMonthly: "₪0",
    desc: "סריקה ידנית פעם בחודש, טקסט בלבד",
    features: ["סריקת טקסט בלבד", "סריקה ידנית 1x/חודש", "קישור מתנתק אחרי סריקה"],
  },
  {
    id: "basic", name: "בסיס", icon: "📅",
    priceYearly: "₪19/חודש", priceMonthly: "₪24/חודש",
    desc: "סריקה שבועית + טקסט + מדיה",
    features: ["סריקה אוטומטית שבועית", "טקסט + תמונות + וידאו + קוליות", "קישור WA קבוע", "טיפים לילד/ה"],
  },
  {
    id: "advanced", name: "מתקדמת", icon: "⚡",
    priceYearly: "₪29/חודש", priceMonthly: "₪34/חודש",
    desc: "סריקה יומית + טקסט + מדיה + התראות",
    features: ["סריקה אוטומטית יומית", "טקסט + תמונות + וידאו + קוליות", "קישור WA קבוע", "טיפים + התראות מיידיות"],
  },
];

export default function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"home" | "plan" | "guides" | "coparent">("home");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-sm">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">הלינק לא תקין</h1>
          <p className="text-slate-500">נסו לבקש לינק חדש מהבוט בוואטסאפ</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-500">טוען...</div>
      </div>
    );
  }

  const { parent, children, subscription } = data;

  const changePlan = async (planId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/portal/${token}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      if (res.ok) {
        setData((prev) => prev ? { ...prev, subscription: { ...prev.subscription, plan: planId } } : prev);
      }
    } finally {
      setSaving(false);
    }
  };

  const totalAlerts = children.reduce((s, c) => s + c.newAlertCount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2">
          <span className="text-2xl">🛡️</span>
          <h1 className="text-lg font-bold text-slate-900">שומר</h1>
          <span className="text-slate-400 mx-1">—</span>
          <span className="text-sm text-slate-500">שלום {parent.name || parent.phone}</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-lg mx-auto flex">
          {[
            { id: "home" as const, label: "הילדים", icon: "👨‍👩‍👧‍👦" },
            { id: "plan" as const, label: "מנוי", icon: "💳" },
            { id: "coparent" as const, label: "הורה נוסף", icon: "👥" },
            { id: "guides" as const, label: "מדריכים", icon: "📚" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-center text-sm font-medium transition cursor-pointer ${tab === t.id ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500 hover:text-slate-700"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-6">
        {tab === "home" && <ChildrenTab children={children} totalAlerts={totalAlerts} subscription={subscription} />}
        {tab === "plan" && <PlanTab current={subscription.plan} onSelect={changePlan} saving={saving} childCount={children.length} />}
        {tab === "coparent" && <CoParentTab token={token} children={children} />}
        {tab === "guides" && <GuidesTab />}
      </main>
    </div>
  );
}

// ── Children Tab ──

function ChildrenTab({ children, totalAlerts, subscription }: {
  children: ChildData[];
  totalAlerts: number;
  subscription: PortalData["subscription"];
}) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{children.length}</div>
          <div className="text-xs text-slate-500">{children.length === 1 ? "ילד/ה" : "ילדים"}</div>
        </div>
        <div className={`bg-white rounded-xl border p-3 text-center ${totalAlerts > 0 ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
          <div className={`text-2xl font-bold ${totalAlerts > 0 ? "text-red-600" : "text-green-600"}`}>{totalAlerts}</div>
          <div className="text-xs text-slate-500">התראות</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
          <div className="text-2xl font-bold text-slate-700">
            {subscription.plan === "advanced" ? "⚡" : subscription.plan === "basic" ? "📅" : "🆓"}
          </div>
          <div className="text-xs text-slate-500">{subscription.plan === "advanced" ? "מתקדמת" : subscription.plan === "basic" ? "בסיס" : "חינם"}</div>
        </div>
      </div>

      {/* Children list */}
      {children.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="text-4xl mb-3">👶</div>
          <p className="text-slate-500">עדיין לא הוספת ילדים. שלחו &quot;הוסף ילד&quot; בוואטסאפ.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {children.map((child) => {
            const genderIcon = child.childGender === "girl" ? "👧" : "👦";
            const statusDot = child.status === "ready" ? "bg-green-500" : "bg-slate-300";

            return (
              <div key={child.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{genderIcon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{child.childName}</span>
                      <span className={`w-2 h-2 rounded-full ${statusDot}`} />
                    </div>
                    <div className="text-xs text-slate-400">קוד: {child.scanCode}</div>
                  </div>
                  {child.newAlertCount > 0 && (
                    <span className={`text-sm font-bold px-2 py-1 rounded-full ${child.hasUrgent ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {child.newAlertCount} {child.hasUrgent ? "🔴" : "🟡"}
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  {child.lastScanDate
                    ? `סריקה אחרונה: ${new Date(child.lastScanDate * 1000).toLocaleDateString("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "טרם נסרק"}
                </div>
                {child.parents.length > 1 && (
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {child.parents.map((p, i) => (
                      <span key={i} className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                        {p.role === "owner" ? "👑" : "👤"} {p.name || p.phone}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Plan Tab ──

function PlanTab({ current, onSelect, saving, childCount }: {
  current: string; onSelect: (id: string) => void; saving: boolean; childCount: number;
}) {
  const [billing, setBilling] = useState<"yearly" | "monthly">("yearly");

  const getPrice = (plan: typeof PLANS[0], count: number) => {
    if (plan.id === "free") return 0;
    const base = billing === "yearly"
      ? parseInt(plan.priceYearly)
      : parseInt(plan.priceMonthly);
    let total = base;
    for (let i = 2; i <= count; i++) {
      total += Math.round(base * 0.7); // 30% off
    }
    return total;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">בחירת תוכנית</h2>

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-2 bg-slate-100 rounded-lg p-1">
        <button onClick={() => setBilling("yearly")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition cursor-pointer ${billing === "yearly" ? "bg-white shadow text-blue-600" : "text-slate-500"}`}>
          שנתי 💰
        </button>
        <button onClick={() => setBilling("monthly")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition cursor-pointer ${billing === "monthly" ? "bg-white shadow text-blue-600" : "text-slate-500"}`}>
          חודשי
        </button>
      </div>
      {billing === "yearly" && (
        <p className="text-xs text-green-600 text-center font-medium">חיסכון של עד ₪60 בשנה בתשלום שנתי!</p>
      )}

      {childCount > 1 && (
        <div className="bg-blue-50 rounded-lg border border-blue-100 p-3 text-center">
          <span className="text-sm text-blue-700 font-medium">🎁 30% הנחה מהילד השני ({childCount} ילדים)</span>
        </div>
      )}

      {PLANS.map((plan) => {
        const price = getPrice(plan, childCount);

        return (
          <div key={plan.id}
            className={`rounded-xl border-2 p-5 transition ${current === plan.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{plan.icon}</span>
                  <span className="font-bold text-slate-800 text-lg">{plan.name}</span>
                </div>
                <p className="text-sm text-slate-500 mt-1">{plan.desc}</p>
              </div>
              <div className="text-left">
                {plan.id === "free" ? (
                  <span className="text-2xl font-bold text-slate-700">₪0</span>
                ) : (
                  <>
                    <span className="text-2xl font-bold text-slate-800">₪{price}</span>
                    <span className="text-sm text-slate-400">/חודש</span>
                    {billing === "monthly" && (
                      <div className="text-xs text-slate-400 line-through">₪{getPrice(plan, childCount)}</div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Features */}
            <ul className="space-y-1 mb-3">
              {plan.features.map((f, i) => (
                <li key={i} className="text-sm text-slate-600 flex items-center gap-1.5">
                  <span className="text-green-500 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>

            {current === plan.id ? (
              <div className="text-sm text-blue-600 font-medium">✓ התוכנית הנוכחית</div>
            ) : (
              <button onClick={() => onSelect(plan.id)} disabled={saving}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                  plan.id === "free"
                    ? "border border-slate-300 text-slate-600 hover:bg-slate-50"
                    : plan.id === "advanced"
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-blue-500 hover:bg-blue-600 text-white"
                } disabled:opacity-50`}>
                {saving ? "שומר..." : plan.id === "free" ? "מעבר לחינם" : "שדרוג"}
              </button>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-400 text-center">
        אמצעי תשלום מאובטח. ביטול בכל עת ללא התחייבות.
      </p>
    </div>
  );
}

// ── Co-Parent Tab ──

function CoParentTab({ token, children }: { token: string; children: ChildData[] }) {
  const [phone, setPhone] = useState("");
  const [selectedChild, setSelectedChild] = useState(children[0]?.id || "");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sendInvite = async () => {
    if (!phone || !selectedChild) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/portal/${token}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedChild, phone }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✅ ${data.message}`);
        setPhone("");
      } else {
        setMessage(`❌ ${data.error === "cannot_invite_self" ? "לא ניתן להזמין את עצמך" : "שגיאה בשליחה"}`);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">הוספת הורה נוסף</h2>
      <p className="text-sm text-slate-500">
        שתפו גישה עם בן/בת זוג, סבא/סבתא, או מטפל נוסף. הם יקבלו את אותם דוחות והתראות.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        {children.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ילד/ה</label>
            <select value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm">
              {children.map((c) => (
                <option key={c.id} value={c.id}>{c.childName}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">מספר טלפון של ההורה</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="050-1234567"
            dir="ltr"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>

        <button onClick={sendInvite} disabled={sending || !phone}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white py-2.5 rounded-lg text-sm font-medium transition cursor-pointer">
          {sending ? "שולח..." : "שליחת הזמנה בוואטסאפ"}
        </button>

        {message && (
          <p className={`text-sm ${message.startsWith("✅") ? "text-green-600" : "text-red-600"}`}>{message}</p>
        )}
      </div>

      {/* Show existing parents per child */}
      {children.some((c) => c.parents.length > 1) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">הורים מחוברים</h3>
          {children.filter((c) => c.parents.length > 1).map((child) => (
            <div key={child.id} className="bg-white rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-slate-800 mb-1">
                {child.childGender === "girl" ? "👧" : "👦"} {child.childName}
              </div>
              <div className="space-y-1">
                {child.parents.map((p, i) => (
                  <div key={i} className="text-sm text-slate-500 flex items-center gap-2">
                    <span>{p.role === "owner" ? "👑" : "👤"}</span>
                    <span>{p.name || "ללא שם"}</span>
                    <span className="text-slate-400" dir="ltr">{p.phone}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Guides Tab ──

const GUIDES = [
  {
    id: "wa-safe-settings",
    icon: "⚙️",
    title: "הגדרות בטוחות בוואטסאפ — מדריך שלב אחר שלב",
    audience: "כל הגילאים — לעשות יחד עם הילד",
    content: [],
    steps: [
      {
        title: "📍 כיבוי שיתוף מיקום חי",
        path: "הגדרות → פרטיות → מיקום חי",
        instructions: [
          "ודאו ש'מיקום חי' כבוי לחלוטין — אין אף שיחה עם שיתוף מיקום פעיל.",
          "הסבירו לילד: 'מיקום חי מראה לכולם איפה אתה בדיוק. זה מסוכן.'",
        ],
      },
      {
        title: "👤 הסתרת תמונת פרופיל",
        path: "הגדרות → פרטיות → תמונת פרופיל → אנשי הקשר שלי",
        instructions: [
          "שנו מ-'כולם' ל-'אנשי הקשר שלי' — ככה זרים לא יכולים לראות את התמונה.",
          "עדיף להימנע מתמונת פנים ברורה כתמונת פרופיל.",
        ],
      },
      {
        title: "🕐 הסתרת 'נראה לאחרונה' ו'מחובר'",
        path: "הגדרות → פרטיות → נראה לאחרונה ומחובר → אנשי הקשר שלי",
        instructions: [
          "שנו ל-'אנשי הקשר שלי' — ככה זרים לא יודעים מתי הילד מחובר.",
          "זה מונע מעקב של 'מתי הילד ער' או 'מתי הוא ליד הטלפון'.",
        ],
      },
      {
        title: "✅ אישורי קריאה",
        path: "הגדרות → פרטיות → אישורי קריאה",
        instructions: [
          "שקלו לכבות — ככה אין לחץ 'למה קראת ולא ענית'.",
          "זה מפחית לחץ חברתי ומונע סיטואציות של 'ראית את ההודעה!'",
        ],
      },
      {
        title: "👥 הגבלת הוספה לקבוצות",
        path: "הגדרות → פרטיות → קבוצות → אנשי הקשר שלי",
        instructions: [
          "שנו ל-'אנשי הקשר שלי' — ככה זרים לא יכולים להוסיף את הילד לקבוצות.",
          "חשוב! זה מונע הוספה לקבוצות זדוניות או מביכות.",
        ],
      },
      {
        title: "🔒 נעילת אפליקציה",
        path: "הגדרות → פרטיות → נעילת אפליקציה",
        instructions: [
          "הפעילו נעילה ביומטרית (טביעת אצבע / Face ID).",
          "ככה גם אם מישהו לוקח את הטלפון, הוא לא יכול לפתוח את הוואטסאפ.",
        ],
      },
      {
        title: "📝 הסתרת 'אודות'",
        path: "הגדרות → פרטיות → אודות → אנשי הקשר שלי",
        instructions: [
          "שנו ל-'אנשי הקשר שלי'.",
          "ודאו שהטקסט ב-'אודות' לא מכיל מידע אישי (גיל, בית ספר, כיתה).",
        ],
      },
      {
        title: "🚫 חסימת אנשי קשר לא רצויים",
        path: "הגדרות → פרטיות → חסומים",
        instructions: [
          "הראו לילד איך לחסום — לחיצה ארוכה על הודעה → חסימה.",
          "הדגישו: 'חסימה זה בסדר. זה לא גסות, זה שמירה על עצמך.'",
          "ילד שיודע לחסום ירגיש יותר בשליטה.",
        ],
      },
      {
        title: "📱 אימות דו-שלבי",
        path: "הגדרות → חשבון → אימות דו-שלבי",
        instructions: [
          "הפעילו PIN של 6 ספרות — מונע מישהו להשתלט על החשבון.",
          "שמרו את ה-PIN במקום בטוח (לא בטלפון של הילד).",
          "הוסיפו אימייל לשחזור — של ההורה, לא של הילד.",
        ],
      },
      {
        title: "📥 הגבלת הורדה אוטומטית",
        path: "הגדרות → אחסון ונתונים → הורדה אוטומטית של מדיה",
        instructions: [
          "כבו הורדה אוטומטית ב-WiFi ובנתונים סלולריים — לפחות ל'סרטונים'.",
          "ככה תמונות וסרטונים לא נשמרים אוטומטית בגלריה.",
          "מונע מצב שתוכן לא הולם נשמר בטלפון בלי ששמו לב.",
        ],
      },
      {
        title: "👻 הודעות נעלמות",
        path: "הגדרות → פרטיות → טיימר ברירת מחדל להודעות",
        instructions: [
          "שקלו להפעיל טיימר של 90 יום כברירת מחדל.",
          "יתרון: פחות 'עדויות' שאפשר להפיץ.",
          "חיסרון: קשה יותר לתעד בריונות. שקלו לפי המצב.",
        ],
      },
    ],
  },
  {
    id: "first-phone",
    icon: "📱",
    title: "הטלפון הראשון — מה חשוב לדעת",
    audience: "הורים לילדים בכיתות ד-ו",
    content: [
      "הגדירו חוקים ברורים יחד — לא מלמעלה. ילד שמשתתף בקביעת הכללים ישמור עליהם יותר.",
      "קבעו זמני מסך — לא רק כמות, אלא גם מתי (לא בארוחות, לא אחרי 21:00).",
      "הסבירו שהטלפון הוא כלי, לא צעצוע. יש דברים שעושים ודברים שלא.",
      "התקינו את וואטסאפ רק כשהילד מוכן — אין לחץ. לא כל ילד בכיתה ד' צריך וואטסאפ.",
    ],
  },
  {
    id: "groups",
    icon: "👥",
    title: "קבוצות כיתה — השדה הפתוח",
    audience: "כל הגילאים",
    content: [
      "קבוצות כיתה הן המקום הנפוץ ביותר לבעיות. 70% ממקרי הבריונות הדיגיטלית קורים שם.",
      "שאלו את הילד: 'מה קורה בקבוצת הכיתה?' — שאלה פתוחה, לא חוקרנית.",
      "אם הילד נשמע מתוח לגבי קבוצה מסוימת — זה סימן לשים לב.",
      "ילד שמבקש לצאת מקבוצה — תנו לו. אל תכריחו להישאר 'כי כולם שם'.",
    ],
  },
  {
    id: "strangers",
    icon: "👤",
    title: "זרים באינטרנט — לזהות סימנים",
    audience: "הורים לילדים בגיל 10+",
    content: [
      "טיפוח (grooming) מתחיל תמיד בחברות. מבוגר שמתעניין 'יותר מדי' בילד — דגל אדום.",
      "סימנים: מבקש סודיות, שולח מתנות, מעלה נושאים מיניים בהדרגה.",
      "למדו את הילד: 'אם מישהו מבקש ממך לא לספר להורים — בדיוק אז צריך לספר.'",
      "אל תאיימו ('אחסום לך את הטלפון') — זה יגרום לילד להסתיר.",
    ],
  },
  {
    id: "bullying",
    icon: "💪",
    title: "בריונות ברשת — מה עושים",
    audience: "כל הגילאים",
    content: [
      "בריונות ברשת פוגעת יותר מפיזית — כי אין הפסקה, היא מגיעה עד לחדר.",
      "אם הילד קורבן: האמינו לו, אל תאשימו, צלמו מסך, פנו לבית הספר.",
      "אם הילד בריון: דברו על אמפתיה, לא ענישה.",
      "דיווח לבית הספר לגיטימי וחשוב. זה לא 'הלשנה'.",
    ],
  },
  {
    id: "privacy",
    icon: "🔒",
    title: "פרטיות — מה לא לשתף",
    audience: "כל הגילאים",
    content: [
      "כתובת, שם בית ספר, מספר טלפון — לא משתפים אונליין.",
      "מיקום חי — רק עם הורים. אף פעם עם אנשים שלא מכירים אישית.",
      "'חוק הסבתא' — אם לא הייתי מראה את זה לסבתא, לא שולח.",
      "הגדרות פרטיות בוואטסאפ: Last Seen, Profile Photo, About → Contacts Only.",
    ],
  },
  {
    id: "open-communication",
    icon: "💬",
    title: "איך מדברים עם ילד על העולם הדיגיטלי",
    audience: "כל הגילאים",
    content: [
      "שאלות פתוחות: 'ספר לי על הקבוצות שלך' במקום 'עם מי דיברת?'",
      "שתפו מעצמכם: 'קיבלתי היום הודעה מוזרה...'",
      "אל תשפטו. 'תודה שסיפרת לי' לפני הכל.",
      "המטרה: שהילד ירגיש בנוח לפנות אליכם. לא שיפחד שתגלו.",
    ],
  },
];

function GuidesTab() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">מדריכים להורים</h2>
      <p className="text-sm text-slate-500 mb-4">
        תוכן מקצועי שיעזור לכם להדריך את הילדים לשימוש בטוח באינטרנט
      </p>

      {GUIDES.map((guide) => (
        <div key={guide.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button onClick={() => setOpen(open === guide.id ? null : guide.id)}
            className="w-full px-5 py-4 flex items-center gap-3 text-right cursor-pointer hover:bg-slate-50 transition">
            <span className="text-2xl">{guide.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-800">{guide.title}</div>
              <div className="text-xs text-slate-400">{guide.audience}</div>
            </div>
            <span className={`text-slate-400 transition-transform ${open === guide.id ? "rotate-90" : ""}`}>←</span>
          </button>

          {open === guide.id && (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4">
              {/* Regular content */}
              {guide.content.length > 0 && (
                <ul className="space-y-3">
                  {guide.content.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="text-blue-500 mt-0.5 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Step-by-step format (for settings guide) */}
              {"steps" in guide && (guide as any).steps && (
                <div className="space-y-4">
                  {(guide as any).steps.map((step: any, i: number) => (
                    <div key={i} className="bg-slate-50 rounded-lg p-4">
                      <div className="font-semibold text-slate-800 text-sm mb-1">{step.title}</div>
                      <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 inline-block mb-2 font-mono" dir="ltr">
                        {step.path}
                      </div>
                      <ul className="space-y-1.5">
                        {step.instructions.map((inst: string, j: number) => (
                          <li key={j} className="flex gap-2 text-sm text-slate-600">
                            <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                            <span>{inst}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
