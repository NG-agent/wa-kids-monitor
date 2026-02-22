import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { getContacts, getSafeContacts } from "@/lib/account-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const contacts = getContacts(id);
  const safe = new Set(getSafeContacts(id).map((s: any) => s.jid));
  return NextResponse.json({
    contacts: contacts.map((c: any) => ({ ...c, isSafe: safe.has(c.jid) })),
  });
}
