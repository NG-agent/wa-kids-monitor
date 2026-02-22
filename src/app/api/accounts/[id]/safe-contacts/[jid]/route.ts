import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { removeSafeContact } from "@/lib/account-manager";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; jid: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id, jid } = await params;
  removeSafeContact(id, decodeURIComponent(jid));
  return NextResponse.json({ ok: true });
}
