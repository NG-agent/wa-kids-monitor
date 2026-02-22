"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Tab = "overview" | "contacts" | "groups" | "alerts" | "scans";

const SEVERITY_ICON: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" };
const SEVERITY_BG: Record<string, string> = {
  critical: "bg-red-50 border-red-200",
  high: "bg-orange-50 border-orange-200",
  medium: "bg-yellow-50 border-yellow-200",
  low: "bg-blue-50 border-blue-200",
  info: "bg-slate-50 border-slate-200",
};
const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-red-800", high: "text-orange-800", medium: "text-yellow-800", low: "text-blue-800", info: "text-slate-700",
};
const CATEGORY_LABELS: Record<string, string> = {
  exclusion: "חרם", suicidal: "אובדנות", grooming: "טיפוח", sexual: "מיני", drugs: "סמים",
  bullying: "בריונות", violence: "אלימות", pressure: "לחץ", language: "שפה פוגענית",
  self_harm: "פגיעה עצמית", weapon: "נשק", threat: "איום", personal_info: "מידע אישי",
};

function calcAge(bd: string | null): number | null {
  if (!bd) return null;
  const b = new Date(bd);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

export default function ChildDetailPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [tab, setTab] = useState<Tab>("overview");
  const [account, setAccount] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [scans, setScans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
  }, [authStatus, router]);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}`);
      if (!res.ok) { router.push("/"); return; }
      setAccount(await res.json());
    } catch {}
  }, [id, router]);

  const loadContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}/contacts`);
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch {}
  }, [id]);

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}/alerts`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch {}
  }, [id]);

  const loadScans = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${id}/scans`);
      const data = await res.json();
      setScans(data.scans || []);
    } catch {}
  }, [id]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    Promise.all([loadAccount(), loadContacts(), loadAlerts(), loadScans()]).then(() => setLoading(false));
  }, [authStatus, loadAccount, loadContacts, loadAlerts, loadScans]);

  const runScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/accounts/${id}/scan`, { method: "POST" });
      const data = await res.json();
      setScanResult(data);
      loadAlerts();
      loadScans();
      loadAccount();
    } catch {}
    setScanning(false);
  };

  const toggleSafe = async (jid: string, name: string, currently: boolean) => {
    if (currently) {
      await fetch(`/api/accounts/${id}/safe-contacts/${encodeURIComponent(jid)}`, { method: "DELETE" });
    } else {
      await fetch(`/api/accounts/${id}/safe-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid, name, relationship: "חבר/ה" }),
      });
    }
    loadContacts();
  };

  const updateAlertStatus = async (alertId: number, status: string) => {
    await fetch(`/api/alerts/${alertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadAlerts();
  };

  const deleteChild = async () => {
    if (!confirm("האם למחוק את החשבון? לא ניתן לשחזר.")) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    router.push("/");
  };

  if (authStatus === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-500">טוען...</div>
      </div>
    );
  }

  if (!account) return null;

  const age = calcAge(account.child_birthdate);
  const genderIcon = account.child_gender === "girl" ? "👧" : "👦";
  const statusColor = account.status === "ready" ? "text-green-600" : "text-slate-400";
  const statusText = account.status === "ready" ? "מחובר" : account.status === "syncing" ? "מסנכרן..." : "מנותק";

  const groups = contacts.filter((c) => c.is_group);
  const individuals = contacts.filter((c) => !c.is_group);
  const filteredContacts = (tab === "contacts" ? individuals : groups).filter((c) =>
    !contactSearch || (c.name || "").includes(contactSearch) || c.jid.includes(contactSearch)
  );

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "סקירה" },
    { key: "contacts", label: "אנשי קשר", count: individuals.length },
    { key: "groups", label: "קבוצות", count: groups.length },
    { key: "alerts", label: "התראות", count: alerts.filter((a) => a.status === "new").length },
    { key: "scans", label: "סריקות", count: scans.length },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3 mb-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm">← חזרה</Link>
            <span className="text-slate-300">|</span>
            <span className="text-2xl">{genderIcon}</span>
            <h1 className="text-lg font-bold text-slate-800">{account.child_name || account.id}</h1>
            {age !== null && <span className="text-sm text-slate-400">(גיל {age})</span>}
            <span className={`text-sm font-medium ${statusColor}`}>● {statusText}</span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
                  tab === t.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}>
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`mr-1 text-xs px-1.5 py-0.5 rounded-full ${
                    t.key === "alerts" && t.count > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
                  }`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">

        {/* ═══════════ OVERVIEW TAB ═══════════ */}
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="הודעות" value={account.messageCount?.toLocaleString() || "0"} icon="📨" />
              <StatCard label="אנשי קשר" value={String(individuals.length)} icon="👥" />
              <StatCard label="קבוצות" value={String(groups.length)} icon="💬" />
              <StatCard label="התראות חדשות" value={String(alerts.filter((a) => a.status === "new").length)}
                icon="🔔" highlight={alerts.some((a) => a.status === "new")} />
            </div>

            {/* Scan button */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">סריקת AI</h3>
                  <p className="text-sm text-slate-500">
                    {account.lastScan
                      ? `סריקה אחרונה: ${new Date(account.lastScan.started_at * 1000).toLocaleString("he-IL")}`
                      : "טרם בוצעה סריקה"}
                  </p>
                </div>
                <button onClick={runScan} disabled={scanning}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-5 py-2.5 rounded-lg font-medium transition cursor-pointer">
                  {scanning ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      סורק...
                    </span>
                  ) : "🔍 סריקה עכשיו"}
                </button>
              </div>

              {scanResult && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                  ✅ נסרקו {scanResult.messagesScanned} הודעות · {scanResult.alerts?.length || 0} ממצאים ·
                  {(scanResult.durationMs / 1000).toFixed(1)} שניות
                </div>
              )}
            </div>

            {/* Recent alerts */}
            {alerts.filter((a) => a.status === "new").length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-800 mb-2">התראות אחרונות</h3>
                <div className="space-y-2">
                  {alerts.filter((a) => a.status === "new").slice(0, 5).map((alert) => (
                    <AlertCard key={alert.id} alert={alert} expanded={expandedAlert === alert.id}
                      onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                      onUpdateStatus={updateAlertStatus} />
                  ))}
                </div>
              </div>
            )}

            {/* Danger zone */}
            <div className="border border-red-200 rounded-xl p-4 mt-6">
              <button onClick={deleteChild}
                className="text-red-600 hover:text-red-800 text-sm font-medium cursor-pointer">
                🗑️ מחיקת חשבון
              </button>
            </div>
          </div>
        )}

        {/* ═══════════ CONTACTS TAB ═══════════ */}
        {tab === "contacts" && (
          <div>
            <div className="mb-4">
              <input type="text" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)}
                placeholder="🔍 חיפוש אנשי קשר..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              {filteredContacts.map((c) => (
                <div key={c.jid} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">{c.name || c.jid.split("@")[0]}</div>
                    <div className="text-xs text-slate-400">{c.message_count} הודעות · {c.jid.replace("@s.whatsapp.net", "")}</div>
                  </div>
                  <button onClick={() => toggleSafe(c.jid, c.name, c.isSafe)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                      c.isSafe
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}>
                    {c.isSafe ? "🔒 בטוח" : "סמן כבטוח"}
                  </button>
                </div>
              ))}
              {filteredContacts.length === 0 && (
                <div className="text-center py-8 text-slate-400">לא נמצאו אנשי קשר</div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ GROUPS TAB ═══════════ */}
        {tab === "groups" && (
          <div>
            <div className="mb-4">
              <input type="text" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)}
                placeholder="🔍 חיפוש קבוצות..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              {filteredContacts.map((c) => (
                <div key={c.jid} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
                  <span className="text-xl">💬</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">{c.name || c.jid.split("@")[0]}</div>
                    <div className="text-xs text-slate-400">{c.message_count} הודעות{c.member_count ? ` · ${c.member_count} חברים` : ""}</div>
                  </div>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">מנוטר</span>
                </div>
              ))}
              {filteredContacts.length === 0 && (
                <div className="text-center py-8 text-slate-400">לא נמצאו קבוצות</div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ ALERTS TAB ═══════════ */}
        {tab === "alerts" && (
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-slate-600 font-medium">אין התראות</p>
                <p className="text-sm text-slate-400">הכל נראה תקין</p>
              </div>
            ) : (
              alerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} expanded={expandedAlert === alert.id}
                  onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                  onUpdateStatus={updateAlertStatus} />
              ))
            )}
          </div>
        )}

        {/* ═══════════ SCANS TAB ═══════════ */}
        {tab === "scans" && (
          <div className="space-y-2">
            {scans.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <p className="text-slate-500">עדיין לא בוצעו סריקות</p>
                <button onClick={runScan} disabled={scanning}
                  className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition cursor-pointer">
                  🔍 סריקה ראשונה
                </button>
              </div>
            ) : (
              scans.map((scan: any) => (
                <div key={scan.id} className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-800">
                      {scan.status === "completed" ? "✅" : scan.status === "failed" ? "❌" : "⏳"}
                      {" "}סריקה #{scan.id}
                    </span>
                    <span className="text-sm text-slate-400">
                      {new Date(scan.started_at * 1000).toLocaleString("he-IL")}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm text-slate-500">
                    <span>{scan.messages_scanned} הודעות</span>
                    <span>{scan.chats_scanned} צ׳אטים</span>
                    <span>{scan.alerts_found} ממצאים</span>
                    {scan.cost > 0 && <span>${scan.cost.toFixed(4)}</span>}
                  </div>
                  {scan.error && <p className="text-sm text-red-600 mt-1">{scan.error}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Components ──

function StatCard({ label, value, icon, highlight }: { label: string; value: string; icon: string; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${highlight ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
      <div className="text-sm text-slate-500 mb-1">{icon} {label}</div>
      <div className={`text-2xl font-bold ${highlight ? "text-red-600" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}

function AlertCard({ alert, expanded, onToggle, onUpdateStatus }: {
  alert: any; expanded: boolean; onToggle: () => void; onUpdateStatus: (id: number, status: string) => void;
}) {
  const icon = SEVERITY_ICON[alert.severity] || "⚪";
  const bg = SEVERITY_BG[alert.severity] || "bg-slate-50 border-slate-200";
  const textColor = SEVERITY_TEXT[alert.severity] || "text-slate-700";
  const catLabel = CATEGORY_LABELS[alert.category] || alert.category;

  return (
    <div className={`rounded-xl border p-4 cursor-pointer transition ${bg}`} onClick={onToggle}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`font-semibold ${textColor}`}>{catLabel}</span>
            <span className="text-xs bg-white/60 rounded px-1.5 py-0.5 text-slate-500">{alert.chat_name}</span>
            {alert.status === "new" && <span className="text-xs bg-red-200 text-red-800 rounded-full px-2 py-0.5">חדש</span>}
            {alert.status === "handled" && <span className="text-xs bg-green-200 text-green-800 rounded-full px-2 py-0.5">טופל</span>}
            <span className="text-xs text-slate-400 mr-auto">
              {new Date(alert.created_at * 1000).toLocaleDateString("he-IL")}
            </span>
          </div>
          <p className={`text-sm ${textColor}`}>{alert.summary}</p>

          {expanded && (
            <div className="mt-3 space-y-2">
              {alert.recommendation && (
                <div className="bg-white/80 rounded-lg p-3 text-sm">
                  <span className="font-medium">💡 המלצה: </span>{alert.recommendation}
                </div>
              )}
              <div className="text-xs text-slate-400">
                ביטחון: {Math.round((alert.confidence || 0) * 100)}%
              </div>
              <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                {alert.status === "new" && (
                  <>
                    <button onClick={() => onUpdateStatus(alert.id, "read")}
                      className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                      👁️ סמן כנקרא
                    </button>
                    <button onClick={() => onUpdateStatus(alert.id, "handled")}
                      className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-200 cursor-pointer">
                      ✅ טופל
                    </button>
                    <button onClick={() => onUpdateStatus(alert.id, "dismissed")}
                      className="text-xs bg-slate-100 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-200 cursor-pointer">
                      ✕ התעלם
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
