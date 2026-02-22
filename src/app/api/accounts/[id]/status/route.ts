import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { getAccount, getContacts, getActiveConnector } from "@/lib/account-manager";
import { queries } from "@/lib/db";
import QRCode from "qrcode";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const account = getAccount(id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const msgCount = queries.getMessageCount.get(id) as { count: number };
  const contacts = getContacts(id);

  // Check if connector has a pending QR
  const connector = getActiveConnector(id);
  let qrDataUrl: string | null = null;

  if (connector && account.status === "qr") {
    // Listen for new QR
    qrDataUrl = await new Promise<string | null>((resolve) => {
      connector.once("qr", async (qr: string) => {
        const url = await QRCode.toDataURL(qr, { width: 300 });
        resolve(url);
      });
      setTimeout(() => resolve(null), 500);
    });
  }

  return NextResponse.json({
    ...account,
    messageCount: msgCount.count,
    contactCount: contacts.length,
    qrDataUrl,
  });
}
