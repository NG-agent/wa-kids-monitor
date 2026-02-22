/**
 * Pricing model for Shomer.
 *
 * Plans:
 *   - free:     ₪0  — manual scan 1x/month, text only, WA disconnects after scan
 *   - basic:    ₪19/mo (yearly) / ₪24/mo (monthly) — 1 child, weekly scan, text + media
 *   - advanced: ₪29/mo (yearly) / ₪34/mo (monthly) — 1 child, daily scan, text + media
 *
 * Multi-child: 30% discount on 2nd child and beyond.
 *
 * Examples:
 *   1 child basic yearly:  ₪19/mo  = ₪228/year
 *   2 children basic yearly: ₪19 + ₪13.30 = ₪32.30/mo
 *   1 child advanced monthly: ₪34/mo
 */

export interface Plan {
  id: string;
  name: string;
  icon: string;
  monthlyPrice: number;   // yearly billing
  monthlyPriceFull: number; // monthly billing (no commitment)
  interval: "weekly" | "daily" | "manual";
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "חינם",
    icon: "🆓",
    monthlyPrice: 0,
    monthlyPriceFull: 0,
    interval: "manual",
    features: [
      "סריקה ידנית פעם בחודש",
      "סריקת טקסט בלבד",
      "קישור וואטסאפ מתנתק אחרי סריקה",
    ],
  },
  {
    id: "basic",
    name: "בסיס",
    icon: "📅",
    monthlyPrice: 19,
    monthlyPriceFull: 24,
    interval: "weekly",
    features: [
      "סריקה אוטומטית שבועית",
      "סריקת טקסט + תמונות + וידאו + הודעות קוליות",
      "קישור וואטסאפ קבוע",
      "טיפים לילד/ה",
      "פרופיל סיכון מצטבר",
    ],
  },
  {
    id: "advanced",
    name: "מתקדמת",
    icon: "⚡",
    monthlyPrice: 29,
    monthlyPriceFull: 34,
    interval: "daily",
    features: [
      "סריקה אוטומטית יומית",
      "סריקת טקסט + תמונות + וידאו + הודעות קוליות",
      "קישור וואטסאפ קבוע",
      "טיפים לילד/ה",
      "פרופיל סיכון מצטבר",
      "התראות מיידיות",
    ],
  },
];

export const MULTI_CHILD_DISCOUNT = 0.30; // 30% off 2nd child and beyond

/**
 * Calculate monthly price for N children.
 */
export function calculatePrice(planId: string, childCount: number, billing: "yearly" | "monthly"): {
  perMonth: number;
  breakdown: { child: number; price: number }[];
} {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan || plan.id === "free") return { perMonth: 0, breakdown: [] };

  const basePrice = billing === "yearly" ? plan.monthlyPrice : plan.monthlyPriceFull;
  const breakdown: { child: number; price: number }[] = [];

  let total = 0;
  for (let i = 1; i <= childCount; i++) {
    const price = i === 1 ? basePrice : Math.round(basePrice * (1 - MULTI_CHILD_DISCOUNT));
    breakdown.push({ child: i, price });
    total += price;
  }

  return { perMonth: total, breakdown };
}

/**
 * Format pricing for WhatsApp upsell message.
 */
export function formatPricingWhatsApp(childCount: number = 1): string {
  const lines: string[] = [];

  lines.push("*💎 תוכניות שומר*");
  lines.push("");

  for (const plan of PLANS) {
    if (plan.id === "free") continue;
    const { perMonth } = calculatePrice(plan.id, childCount, "yearly");
    lines.push(`${plan.icon} *${plan.name}* — ₪${perMonth}/חודש ${childCount > 1 ? `(${childCount} ילדים)` : ""}`);
    lines.push(`   ${plan.interval === "daily" ? "סריקה יומית" : "סריקה שבועית"} + טקסט + מדיה`);
    if (plan.monthlyPriceFull > plan.monthlyPrice) {
      lines.push(`   _₪${plan.monthlyPriceFull}/חו׳ בתשלום חודשי | ₪${plan.monthlyPrice}/חו׳ בתשלום שנתי_`);
    }
    lines.push("");
  }

  if (childCount > 1) {
    lines.push(`🎁 *${MULTI_CHILD_DISCOUNT * 100}% הנחה* מהילד השני והלאה`);
    lines.push("");
  }

  return lines.join("\n");
}
