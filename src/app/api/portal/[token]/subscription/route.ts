import { NextRequest, NextResponse } from "next/server";
import { queries } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = queries.getParentToken.get(token) as any;
  if (!row) return NextResponse.json({ error: "invalid_token" }, { status: 401 });

  const body = await req.json();
  const { plan } = body;

  if (!["free", "basic", "advanced"].includes(plan)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const expiresAt = plan === "free" ? null : Math.floor(Date.now() / 1000) + 30 * 86400;
  queries.upsertSubscription.run(row.parent_id, plan, null, null, expiresAt);

  return NextResponse.json({ ok: true, plan });
}
