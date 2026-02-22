import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { createAccount, listAccounts, getSafeContacts } from "@/lib/account-manager";
import { queries } from "@/lib/db";
import QRCode from "qrcode";

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const accounts = listAccounts().map((acc) => {
    const msgCount = queries.getMessageCount.get(acc.id) as { count: number };
    const lastScan = queries.getLastScan.get(acc.id) as any;
    const safeCount = getSafeContacts(acc.id).length;
    const newAlerts = queries.getNewAlerts.all(acc.id) as any[];
    return {
      ...acc,
      messageCount: msgCount.count,
      safeContactCount: safeCount,
      newAlertCount: newAlerts.length,
      lastScan: lastScan ? {
        date: lastScan.started_at,
        messagesScanned: lastScan.messages_scanned,
        alertsFound: lastScan.alerts_found,
        status: lastScan.status,
      } : null,
    };
  });
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { name, childName, childBirthdate, childGender } = body;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { accountId, connector } = await createAccount(name, childName, childBirthdate, childGender);

  const result = await new Promise<any>((resolve) => {
    connector.on("qr", async (qr: string) => {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
      resolve({ accountId, status: "qr", qrDataUrl });
    });
    connector.on("ready", () => {
      resolve({ accountId, status: "ready" });
    });
    setTimeout(() => resolve({ accountId, status: "waiting" }), 15000);
  });

  return NextResponse.json(result);
}
