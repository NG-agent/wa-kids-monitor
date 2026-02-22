import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { queries } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
  const alerts = queries.getAlerts.all(id, limit);
  return NextResponse.json({ alerts });
}
