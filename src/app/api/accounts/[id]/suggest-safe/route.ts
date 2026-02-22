import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { suggestSafeContacts } from "@/lib/account-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const suggestions = suggestSafeContacts(id);
  return NextResponse.json({ suggestions });
}
