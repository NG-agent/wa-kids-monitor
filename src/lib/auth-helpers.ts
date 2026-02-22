import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { NextResponse } from "next/server";

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), parentId: null, userId: null };
  }
  const parentId = (session.user as any).id as string;
  return { error: null, parentId, userId: parentId };
}
