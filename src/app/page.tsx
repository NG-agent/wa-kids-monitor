"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

interface AccountData {
  id: string;
  child_name: string;
  child_birthdate: string | null;
  child_gender: string | null;
  status: string;
  messageCount: number;
  safeContactCount: number;
  newAlertCount: number;
  lastScan: { date: number; messagesScanned: number; alertsFound: number; status: string } | null;
}

function calcAge(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

export default function DashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => { setAccounts(d.accounts || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [authStatus]);

  if (authStatus === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-500">טוען...</div>
      </div>
    );
  }

  const totalAlerts = accounts.reduce((sum, a) => sum + a.newAlertCount, 0);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛡️</span>
            <h1 className="text-xl font-bold text-slate-900">שומר</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{session?.user?.name || session?.user?.email}</span>
            <button onClick={() => signOut()} className="text-sm text-slate-400 hover:text-slate-600 cursor-pointer">יציאה</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Stats bar */}
        {accounts.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{accounts.length}</div>
              <div className="text-sm text-slate-500">ילדים מחוברים</div>
            </div>
            <div className={`bg-white rounded-xl border p-4 text-center ${totalAlerts > 0 ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
              <div className={`text-2xl font-bold ${totalAlerts > 0 ? "text-red-600" : "text-green-600"}`}>{totalAlerts}</div>
              <div className="text-sm text-slate-500">התראות חדשות</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
              <div className="text-2xl font-bold text-slate-700">{accounts.reduce((s, a) => s + a.messageCount, 0).toLocaleString()}</div>
              <div className="text-sm text-slate-500">הודעות במעקב</div>
            </div>
          </div>
        )}

        {/* Children list */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">הילדים שלי</h2>
          <Link href="/child/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            + הוספת ילד/ה
          </Link>
        </div>

        {accounts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <div className="text-5xl mb-4">👨‍👩‍👧‍👦</div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">עוד לא הוספת ילדים</h3>
            <p className="text-slate-500 mb-6">הוסיפו את הילד הראשון כדי להתחיל לנטר את הוואטסאפ שלו</p>
            <Link href="/child/new"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition inline-block">
              הוספת ילד/ה ראשון/ה
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => {
              const age = calcAge(acc.child_birthdate);
              const genderIcon = acc.child_gender === "girl" ? "👧" : "👦";
              const statusColor = acc.status === "ready" ? "bg-green-500" : acc.status === "connecting" || acc.status === "syncing" ? "bg-yellow-500" : "bg-slate-300";
              const statusText = acc.status === "ready" ? "מחובר" : acc.status === "qr" ? "ממתין לסריקה" : acc.status === "syncing" ? "מסנכרן" : "מנותק";

              return (
                <Link key={acc.id} href={`/child/${acc.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 hover:border-blue-300 hover:shadow-sm transition block">
                  <div className="text-3xl">{genderIcon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800">{acc.child_name || acc.id}</span>
                      {age != null && <span className="text-sm text-slate-400">({age === 1 ? "שנה" : `${age}`})</span>}
                      <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                      <span className="text-xs text-slate-400">{statusText}</span>
                    </div>
                    <div className="flex gap-4 text-sm text-slate-500">
                      <span>📨 {acc.messageCount.toLocaleString()} הודעות</span>
                      <span>🔒 {acc.safeContactCount} בטוחים</span>
                      {acc.lastScan && (
                        <span>🔍 סריקה: {new Date(acc.lastScan.date * 1000).toLocaleDateString("he-IL")}</span>
                      )}
                    </div>
                  </div>
                  {acc.newAlertCount > 0 && (
                    <div className="bg-red-100 text-red-700 rounded-full px-3 py-1 text-sm font-semibold">
                      {acc.newAlertCount} 🔔
                    </div>
                  )}
                  <div className="text-slate-300">←</div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
