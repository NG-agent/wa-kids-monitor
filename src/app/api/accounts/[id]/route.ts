import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { getAccount, deleteAccount } from "@/lib/account-manager";
import { queries } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const account = getAccount(id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const msgCount = queries.getMessageCount.get(id) as { count: number };
  const lastScan = queries.getLastScan.get(id) as any;

  return NextResponse.json({
    ...account,
    messageCount: msgCount.count,
    lastScan: lastScan || null,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  await deleteAccount(id);
  return NextResponse.json({ ok: true });
}
