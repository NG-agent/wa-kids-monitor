import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { getConnector, getAccount } from "@/lib/account-manager";
import QRCode from "qrcode";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const account = getAccount(id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const connector = await getConnector(id);
  if (!connector) return NextResponse.json({ error: "Cannot connect" }, { status: 500 });

  if (connector.isReady()) {
    return NextResponse.json({ status: "ready" });
  }

  const result = await new Promise<any>((resolve) => {
    connector.on("qr", async (qr: string) => {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
      resolve({ status: "qr", qrDataUrl });
    });
    connector.on("ready", () => {
      resolve({ status: "ready" });
    });
    setTimeout(() => resolve({ status: "waiting" }), 15000);
  });

  return NextResponse.json(result);
}
