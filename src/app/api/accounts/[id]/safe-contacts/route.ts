import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { addSafeContact, getSafeContacts } from "@/lib/account-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  return NextResponse.json({ safeContacts: getSafeContacts(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await req.json();

  // Support bulk add
  if (Array.isArray(body.contacts)) {
    for (const c of body.contacts) {
      const jid = c.jid || (c.phone?.includes("@") ? c.phone : `${c.phone?.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
      addSafeContact(id, jid, c.name || jid, c.relationship || "family");
    }
    return NextResponse.json({ ok: true, count: body.contacts.length });
  }

  const { phone, jid: rawJid, name, relationship } = body;
  const jid = rawJid || (phone?.includes("@") ? phone : `${phone?.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
  if (!jid) return NextResponse.json({ error: "phone or jid required" }, { status: 400 });
  addSafeContact(id, jid, name || jid, relationship || "family");
  return NextResponse.json({ ok: true, jid });
}
