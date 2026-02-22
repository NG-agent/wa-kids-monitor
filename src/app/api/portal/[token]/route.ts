import { NextRequest, NextResponse } from "next/server";
import { queries } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = queries.getParentToken.get(token) as any;
  if (!row) return NextResponse.json({ error: "invalid_token" }, { status: 401 });

  const parent = queries.getParent.get(row.parent_id) as any;
  if (!parent) return NextResponse.json({ error: "parent_not_found" }, { status: 404 });

  // Get all children for this parent
  const children = queries.getChildrenForParent.all(row.parent_id) as any[];
  const childrenData = children.map((child: any) => {
    const lastScan = queries.getLastScan.get(child.id) as any;
    const newAlerts = queries.getNewAlerts.all(child.id) as any[];
    const coParents = queries.getParentsForChild.all(child.id) as any[];

    return {
      id: child.id,
      childName: child.child_name,
      childGender: child.child_gender,
      status: child.status,
      scanCode: child.scan_code,
      lastScanDate: lastScan?.started_at || null,
      lastScanStatus: lastScan?.status || null,
      newAlertCount: newAlerts.length,
      hasUrgent: newAlerts.some((a: any) => a.severity === "critical"),
      parents: coParents.map((p: any) => ({ name: p.name, phone: p.phone, role: p.role })),
    };
  });

  const subscription = queries.getSubscription.get(row.parent_id) as any;
  const invites = queries.getInvitesForChild ? [] : []; // pending invites

  return NextResponse.json({
    parent: {
      id: parent.id,
      name: parent.name,
      phone: parent.phone,
    },
    children: childrenData,
    subscription: subscription ? {
      plan: subscription.plan,
      status: subscription.status,
      paymentLast4: subscription.payment_last4,
      expiresAt: subscription.expires_at,
    } : { plan: "free", status: "active" },
  });
}
