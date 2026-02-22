import { NextRequest, NextResponse } from "next/server";
import { queries } from "@/lib/db";
import { inviteCoParent, normalizePhone } from "@/lib/account-manager";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = queries.getParentToken.get(token) as any;
  if (!row) return NextResponse.json({ error: "invalid_token" }, { status: 401 });

  const body = await req.json();
  const { accountId, phone } = body;

  if (!accountId || !phone) {
    return NextResponse.json({ error: "missing accountId or phone" }, { status: 400 });
  }

  // Verify parent owns this child
  if (!queries.isParentOfChild.get(row.parent_id, accountId)) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  // Don't invite yourself
  const parent = queries.getParent.get(row.parent_id) as any;
  if (parent && normalizePhone(phone) === parent.phone) {
    return NextResponse.json({ error: "cannot_invite_self" }, { status: 400 });
  }

  const inviteId = inviteCoParent(accountId, row.parent_id, phone);

  return NextResponse.json({
    ok: true,
    inviteId,
    message: `הזמנה נשלחה ל-${normalizePhone(phone)}`,
  });
}
