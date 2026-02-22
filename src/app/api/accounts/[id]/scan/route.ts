import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { getAccount, getConnector } from "@/lib/account-manager";
import { scanAccount } from "@/lib/scanner";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const account = getAccount(id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Ensure connected
  if (account.status !== "ready") {
    const connector = await getConnector(id);
    if (!connector) return NextResponse.json({ error: "Cannot connect" }, { status: 500 });
    if (!connector.isReady()) {
      await new Promise<void>((resolve) => {
        connector.on("ready", () => resolve());
        setTimeout(() => resolve(), 30000);
      });
    }
  }

  try {
    const result = await scanAccount(id, (msg) => {
      console.log(`[scan ${id}] ${msg}`);
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
