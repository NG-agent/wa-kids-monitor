"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

interface Suggestion {
  jid: string;
  name: string;
  messageCount: number;
  suggestedRelationship: string | null;
  autoSafe: boolean;
}

const RELATIONSHIPS = ["אמא", "אבא", "אח", "אחות", "סבא", "סבתא", "דוד", "דודה", "חבר/ה", "מורה", "אחר"];

const STEP_LABELS = ["פרטי הילד/ה", "תנאי שימוש", "חיבור וואטסאפ", "אנשי קשר בטוחים", "הכל מוכן!"];

export default function AddChildPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(1);

  // Step 1
  const [childName, setChildName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [gender, setGender] = useState<"boy" | "girl" | "">("");

  // Step 2
  const [tosAccepted, setTosAccepted] = useState(false);

  // Step 3 - QR pairing
  const [accountId, setAccountId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairStatus, setPairStatus] = useState<"creating" | "qr" | "syncing" | "ready">("creating");
  const [syncProgress, setSyncProgress] = useState(0);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Step 4 - Safe contacts
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map()); // jid -> relationship
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Step 5 - Done
  const [stats, setStats] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);

  const [error, setError] = useState("");

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
  }, [authStatus, router]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const calcAge = (bd: string) => {
    if (!bd) return null;
    const b = new Date(bd);
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  };

  // ── Step 1 → 2 ──
  const goToStep2 = () => {
    if (!childName.trim()) { setError("נא למלא את שם הילד/ה"); return; }
    if (!birthdate) { setError("נא לבחור תאריך לידה"); return; }
    const age = calcAge(birthdate);
    if (age === null || age < 5 || age > 18) { setError("הגיל חייב להיות בין 5 ל-18"); return; }
    if (!gender) { setError("נא לבחור מין"); return; }
    setError("");
    setStep(2);
  };

  // ── Step 2 → 3 ──
  const goToStep3 = async () => {
    if (!tosAccepted) { setError("יש לאשר את תנאי השימוש"); return; }
    setError("");
    setStep(3);
    setPairStatus("creating");

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: childName, childName, childBirthdate: birthdate, childGender: gender }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "שגיאה ביצירת חשבון"); return; }

      setAccountId(data.accountId);

      if (data.status === "qr") {
        setQrDataUrl(data.qrDataUrl);
        setPairStatus("qr");
      } else if (data.status === "ready") {
        setPairStatus("ready");
      }

      // Accept TOS
      await fetch(`/api/accounts/${data.accountId}/tos`, { method: "POST" });

      // Start polling
      startPolling(data.accountId);
    } catch {
      setError("שגיאה ביצירת חשבון");
    }
  };

  const startPolling = (accId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/accounts/${accId}/status`);
        const data = await res.json();

        if (data.qrDataUrl) setQrDataUrl(data.qrDataUrl);

        if (data.status === "syncing") {
          setPairStatus("syncing");
        } else if (data.status === "ready") {
          setPairStatus("ready");
          if (pollRef.current) clearInterval(pollRef.current);
          // Auto-advance to step 4
          setTimeout(() => goToStep4(accId), 1000);
        }
      } catch {}
    }, 2000);
  };

  // ── Step 3 → 4 ──
  const goToStep4 = useCallback(async (accId?: string) => {
    const id = accId || accountId;
    if (!id) return;
    setStep(4);
    setLoadingSuggestions(true);

    try {
      const res = await fetch(`/api/accounts/${id}/suggest-safe`);
      const data = await res.json();
      const sugs: Suggestion[] = data.suggestions || [];
      setSuggestions(sugs);

      // Pre-select auto-safe ones
      const preSelected = new Map<string, string>();
      for (const s of sugs) {
        if (s.autoSafe && s.suggestedRelationship) {
          preSelected.set(s.jid, s.suggestedRelationship);
        }
      }
      setSelected(preSelected);
    } catch {}
    setLoadingSuggestions(false);
  }, [accountId]);

  // ── Step 4 → 5 ──
  const goToStep5 = async () => {
    if (!accountId) return;

    // Save selected safe contacts
    const contacts = Array.from(selected.entries()).map(([jid, relationship]) => {
      const sug = suggestions.find((s) => s.jid === jid);
      return { jid, name: sug?.name || jid, relationship };
    });

    if (contacts.length > 0) {
      await fetch(`/api/accounts/${accountId}/safe-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
    }

    // Fetch stats
    try {
      const res = await fetch(`/api/accounts/${accountId}/status`);
      const data = await res.json();
      setStats(data);
    } catch {}

    setStep(5);
  };

  const toggleContact = (jid: string, relationship?: string) => {
    const next = new Map(selected);
    if (next.has(jid)) {
      next.delete(jid);
    } else {
      const sug = suggestions.find((s) => s.jid === jid);
      next.set(jid, relationship || sug?.suggestedRelationship || "חבר/ה");
    }
    setSelected(next);
  };

  const setRelationship = (jid: string, rel: string) => {
    const next = new Map(selected);
    next.set(jid, rel);
    setSelected(next);
  };

  const runScan = async () => {
    if (!accountId) return;
    setScanning(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/scan`, { method: "POST" });
      const data = await res.json();
      setScanResult(data);
    } catch {}
    setScanning(false);
  };

  const age = calcAge(birthdate);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-600">← חזרה</Link>
          <span className="text-slate-300">|</span>
          <h1 className="font-semibold text-slate-800">הוספת ילד/ה</h1>
        </div>
      </header>

      {/* Step indicator */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-8">
          {STEP_LABELS.map((label, i) => {
            const stepNum = i + 1;
            const isActive = step === stepNum;
            const isDone = step > stepNum;
            return (
              <div key={i} className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-1 ${
                  isDone ? "bg-green-500 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-400"
                }`}>
                  {isDone ? "✓" : stepNum}
                </div>
                <span className={`text-xs text-center ${isActive ? "text-blue-600 font-medium" : "text-slate-400"}`}>
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <div className="hidden" /> /* connector line handled by flex */
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">{error}</div>
        )}

        {/* ═══════════ STEP 1: Child Details ═══════════ */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800 mb-6">פרטי הילד/ה</h2>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">שם הילד/ה</label>
                <input type="text" value={childName} onChange={(e) => setChildName(e.target.value)}
                  placeholder="למשל: דניאל"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">תאריך לידה</label>
                <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                {age !== null && age >= 0 && (
                  <p className="text-sm text-slate-500 mt-1">גיל: {age}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">מין</label>
                <div className="flex gap-3">
                  <button onClick={() => setGender("boy")}
                    className={`flex-1 py-3 rounded-xl border-2 text-lg font-medium transition cursor-pointer ${
                      gender === "boy" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}>
                    👦 בן
                  </button>
                  <button onClick={() => setGender("girl")}
                    className={`flex-1 py-3 rounded-xl border-2 text-lg font-medium transition cursor-pointer ${
                      gender === "girl" ? "border-pink-500 bg-pink-50 text-pink-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}>
                    👧 בת
                  </button>
                </div>
              </div>
            </div>

            <button onClick={goToStep2}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition cursor-pointer">
              המשך ←
            </button>
          </div>
        )}

        {/* ═══════════ STEP 2: Terms of Service ═══════════ */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800 mb-4">תנאי שימוש</h2>
            <p className="text-sm text-slate-500 mb-4">אנא קראו את תנאי השימוש לפני ההמשך</p>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 h-64 overflow-y-auto text-sm text-slate-700 leading-relaxed mb-4">
              <h3 className="font-bold mb-2">תנאי שימוש — שומר</h3>

              <p className="mb-3">
                <strong>1. מטרת השירות</strong><br />
                האפליקציה "שומר" מנטרת שיחות וואטסאפ של ילדך באמצעות בינה מלאכותית, במטרה לזהות תכנים מסוכנים כגון בריונות, הטרדה מינית, סמים, אובדנות וחרם חברתי.
              </p>

              <p className="mb-3">
                <strong>2. בעלות על המכשיר</strong><br />
                ההורה המשתמש בשירות מצהיר כי הוא הבעלים החוקי של מכשיר הטלפון שעליו מותקן הוואטסאפ המנוטר, וכי הילד/ה מתחת לגיל 18.
              </p>

              <p className="mb-3">
                <strong>3. פרטיות ואבטחת מידע</strong><br />
                תוכן ההודעות נסרק באמצעות מודלי AI בלבד ולא נשמר לאורך זמן. רק סיכומי ניתוח ודגלים נשמרים. המערכת לא שומרת את תוכן ההודעות המקורי לאחר הסריקה.
              </p>

              <p className="mb-3">
                <strong>4. הסכמה מודעת</strong><br />
                מומלץ ליידע את הילד/ה על קיום המערכת ולהסביר שמטרתה הגנה ולא ריגול. שיחה פתוחה עם הילד על בטיחות ברשת חשובה לא פחות מהטכנולוגיה.
              </p>

              <p className="mb-3">
                <strong>5. מגבלות</strong><br />
                המערכת אינה מחליפה השגחה הורית ואינה מבטיחה זיהוי של 100% מהאיומים. יש לראות בה כלי עזר בלבד.
              </p>

              <p className="mb-3">
                <strong>6. גיל הילד</strong><br />
                השירות מיועד לניטור ילדים מתחת לגיל 18 בלבד.
              </p>
            </div>

            <label className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer">
              <input type="checkbox" checked={tosAccepted} onChange={(e) => setTosAccepted(e.target.checked)}
                className="w-5 h-5 rounded accent-blue-600" />
              <span className="text-sm font-medium text-slate-700">אני מאשר/ת את תנאי השימוש</span>
            </label>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setError(""); setStep(1); }}
                className="flex-1 border border-slate-300 text-slate-600 py-3 rounded-lg font-medium hover:bg-slate-50 transition cursor-pointer">
                → חזרה
              </button>
              <button onClick={goToStep3} disabled={!tosAccepted}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white py-3 rounded-lg font-medium transition cursor-pointer">
                המשך ←
              </button>
            </div>
          </div>
        )}

        {/* ═══════════ STEP 3: QR Pairing ═══════════ */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">חיבור וואטסאפ</h2>
            <p className="text-slate-500 mb-6">
              יש לסרוק את הקוד עם הוואטסאפ של {childName}
            </p>

            {pairStatus === "creating" && (
              <div className="py-12">
                <div className="animate-spin w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-4" />
                <p className="text-slate-500">מכין את החיבור...</p>
              </div>
            )}

            {pairStatus === "qr" && qrDataUrl && (
              <div>
                <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 inline-block mb-6">
                  <img src={qrDataUrl} alt="QR Code" className="w-64 h-64" />
                </div>
                <div className="bg-blue-50 rounded-lg p-4 text-sm text-slate-700 text-right max-w-md mx-auto">
                  <p className="font-medium mb-2">📱 הוראות:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>פתחו את הוואטסאפ של <strong>{childName}</strong></li>
                    <li>לכו ל<strong>הגדרות</strong> → <strong>מכשירים מקושרים</strong></li>
                    <li>לחצו על <strong>קשר מכשיר</strong></li>
                    <li>סרקו את הקוד שמעל</li>
                  </ol>
                </div>
              </div>
            )}

            {pairStatus === "syncing" && (
              <div className="py-12">
                <div className="animate-spin w-10 h-10 border-4 border-green-200 border-t-green-600 rounded-full mx-auto mb-4" />
                <p className="text-green-700 font-medium mb-2">✅ מחובר! מסנכרן הודעות...</p>
                <p className="text-sm text-slate-500">זה יכול לקחת כמה דקות</p>
              </div>
            )}

            {pairStatus === "ready" && (
              <div className="py-12">
                <div className="text-5xl mb-4">🎉</div>
                <p className="text-green-700 font-bold text-lg">החיבור הצליח!</p>
                <p className="text-slate-500 mt-2">ממשיכים לשלב הבא...</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════ STEP 4: Safe Contact Suggestions ═══════════ */}
        {step === 4 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🔒</span>
              <h2 className="text-xl font-bold text-slate-800">אנשי קשר בטוחים</h2>
            </div>
            <p className="text-slate-500 text-sm mb-6">
              שיחות עם אנשים בטוחים לא ייסרקו. סמנו את בני המשפחה ואנשים מהימנים:
            </p>

            {loadingSuggestions ? (
              <div className="py-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-3" />
                <p className="text-slate-500">מנתח אנשי קשר...</p>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                <p>לא נמצאו אנשי קשר להצעה.</p>
                <p className="text-sm mt-1">ניתן להוסיף ידנית מאוחר יותר.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                {suggestions.map((sug) => {
                  const isSelected = selected.has(sug.jid);
                  const phone = sug.jid.replace("@s.whatsapp.net", "");
                  return (
                    <div key={sug.jid}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition cursor-pointer ${
                        isSelected ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                      onClick={() => toggleContact(sug.jid)}>
                      <input type="checkbox" checked={isSelected} readOnly
                        className="w-5 h-5 rounded accent-blue-600 pointer-events-none" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 truncate">{sug.name}</div>
                        <div className="text-xs text-slate-400">{phone} — {sug.messageCount.toLocaleString()} הודעות</div>
                      </div>
                      {isSelected && (
                        <select
                          value={selected.get(sug.jid) || "חבר/ה"}
                          onChange={(e) => { e.stopPropagation(); setRelationship(sug.jid, e.target.value); }}
                          onClick={(e) => e.stopPropagation()}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white outline-none">
                          {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                      {sug.autoSafe && !isSelected && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">מומלץ</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={() => goToStep5()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition cursor-pointer">
                {selected.size > 0 ? `אשר ${selected.size} אנשי קשר והמשך ←` : "דלג והמשך ←"}
              </button>
            </div>
          </div>
        )}

        {/* ═══════════ STEP 5: Done ═══════════ */}
        {step === 5 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">
              הכל מוכן! {childName} {gender === "girl" ? "מחוברת" : "מחובר"}
            </h2>

            {stats && (
              <div className="grid grid-cols-3 gap-3 my-6 max-w-sm mx-auto">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-lg font-bold text-slate-700">{stats.contactCount || 0}</div>
                  <div className="text-xs text-slate-500">אנשי קשר</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-lg font-bold text-slate-700">{stats.messageCount?.toLocaleString() || 0}</div>
                  <div className="text-xs text-slate-500">הודעות</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-lg font-bold text-slate-700">{selected.size}</div>
                  <div className="text-xs text-slate-500">בטוחים</div>
                </div>
              </div>
            )}

            {!scanResult ? (
              <button onClick={runScan} disabled={scanning}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white px-6 py-3 rounded-lg font-medium transition mb-3 cursor-pointer w-full max-w-sm">
                {scanning ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    סורק...
                  </span>
                ) : "🔍 בצע סריקה ראשונה"}
              </button>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 max-w-sm mx-auto text-right">
                <p className="font-medium text-green-800 mb-1">✅ הסריקה הושלמה</p>
                <p className="text-sm text-green-700">
                  {scanResult.messagesScanned} הודעות נסרקו · {scanResult.alerts?.length || 0} ממצאים
                </p>
              </div>
            )}

            <Link href="/"
              className="block w-full max-w-sm mx-auto border border-slate-300 text-slate-600 py-3 rounded-lg font-medium hover:bg-slate-50 transition text-center">
              חזרה לדשבורד
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
