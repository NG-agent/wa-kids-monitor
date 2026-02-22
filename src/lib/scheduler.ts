/**
 * Scan scheduler — runs automatic scans for paid accounts.
 * - Weekly plan: scan once a week
 * - Daily plan: scan once a day
 * Free plan: no automatic scans (manual only, WA disconnected after scan).
 */

import { queries } from "./db";
import { getChildrenForParent, getConnector, getParentsForChild } from "./account-manager";
import { scanAccount } from "./scanner";

// ── Config ──

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // check every hour
const DAILY_INTERVAL = 24 * 60 * 60;      // 24h in seconds
const WEEKLY_INTERVAL = 7 * 24 * 60 * 60; // 7 days in seconds

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the scheduler. Checks every hour which accounts need scanning.
 */
export function startScheduler(): void {
  if (schedulerTimer) return; // already running

  console.log("[Scheduler] Starting — checking every hour for due scans");

  // Run immediately on start, then every hour
  checkAndScan().catch((err) => console.error("[Scheduler] Error:", err));

  schedulerTimer = setInterval(() => {
    checkAndScan().catch((err) => console.error("[Scheduler] Error:", err));
  }, SCAN_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[Scheduler] Stopped");
  }
}

/**
 * Check all paid accounts and scan those that are due.
 */
async function checkAndScan(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const accounts = queries.listAccounts.all() as any[];

  for (const account of accounts) {
    try {
      const plan = getAccountPlan(account.id);
      if (plan === "free") continue;

      const interval = plan === "advanced" ? DAILY_INTERVAL : WEEKLY_INTERVAL;

      // Check last scan time
      const lastScan = queries.getLastScan.get(account.id) as any;
      const lastScanTime = lastScan?.started_at || 0;

      if (now - lastScanTime < interval) continue; // not due yet

      // Ensure WA is connected
      if (account.status !== "ready") {
        console.log(`[Scheduler] ${account.id} (${account.child_name}) — reconnecting WA...`);
        const connector = await getConnector(account.id);
        if (!connector || !connector.isReady()) {
          console.log(`[Scheduler] ${account.id} — WA not ready, skipping`);
          continue;
        }
        // Wait a bit for sync
        await new Promise((r) => setTimeout(r, 10000));
      }

      console.log(`[Scheduler] Scanning ${account.id} (${account.child_name}) — plan: ${plan}`);

      const result = await scanAccount(account.id, (msg) => {
        console.log(`[Scheduler] [${account.child_name}] ${msg}`);
      });

      console.log(`[Scheduler] ${account.child_name}: ${result.messagesScanned} messages, ${result.alerts.length} alerts`);

      // TODO: Send report via WhatsApp Business API to parent(s)

    } catch (err) {
      console.error(`[Scheduler] Error scanning ${account.id}:`, err);
    }
  }
}

/**
 * Get the effective plan for an account (checks all linked parents).
 */
function getAccountPlan(accountId: string): string {
  const parents = getParentsForChild(accountId);
  if (parents.length === 0) return "free";

  let bestPlan = "free";
  for (const parent of parents) {
    const sub = queries.getSubscription.get(parent.id) as any;
    if (!sub || sub.status !== "active") continue;

    if (sub.plan === "advanced") return "advanced"; // best possible
    if (sub.plan === "basic" && bestPlan === "free") bestPlan = "basic";
  }
  return bestPlan;
}

/**
 * Get next scan time for an account (for display).
 */
export function getNextScanTime(accountId: string): { nextScan: number | null; plan: string } {
  const plan = getAccountPlan(accountId);
  if (plan === "free") return { nextScan: null, plan };

  const interval = plan === "advanced" ? DAILY_INTERVAL : WEEKLY_INTERVAL;
  const lastScan = queries.getLastScan.get(accountId) as any;
  const lastScanTime = lastScan?.started_at || 0;

  return {
    nextScan: lastScanTime + interval,
    plan,
  };
}
