"use client";

import { signIn, useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) router.push("/");
  }, [session, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) { setError("נדרש מספר טלפון"); return; }
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { phone, name, redirect: false });
    if (res?.error) {
      setError("ההתחברות נכשלה. נסו שוב.");
      setLoading(false);
    } else {
      router.push("/");
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-500">טוען...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🛡️</div>
          <h1 className="text-2xl font-bold text-slate-900">שומר</h1>
          <p className="text-slate-500 mt-2">ניטור וואטסאפ חכם להורים</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">מספר טלפון</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="050-1234567" required dir="ltr"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <p className="text-xs text-slate-400 mt-1">המספר ישמש לזיהוי שלך ולקבלת דוחות בוואטסאפ</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם (אופציונלי)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="השם שלך"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white py-2.5 rounded-lg font-medium transition cursor-pointer">
            {loading ? "מתחבר..." : "התחברות"}
          </button>
        </form>
      </div>
    </div>
  );
}
