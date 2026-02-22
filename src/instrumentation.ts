/**
 * Next.js instrumentation — runs once on server startup.
 * Starts the automatic scan scheduler for paid accounts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    console.log("[App] Scan scheduler started");
  }
}
