import express from "express";
import {
  createAccount,
  listAccounts,
  getAccount,
  getConnector,
  addSafeContact,
  removeSafeContact,
  getSafeContacts,
  getContacts,
  deleteAccount,
} from "./lib/account-manager.js";
import { scanAccount } from "./lib/scanner.js";
import { queries } from "./lib/db.js";
import QRCode from "qrcode";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3001");

// ── Accounts ──

app.get("/api/accounts", (req, res) => {
  const accounts = listAccounts().map((acc) => {
    const msgCount = queries.getMessageCount.get(acc.id) as { count: number };
    const lastScan = queries.getLastScan.get(acc.id) as any;
    const safeCount = getSafeContacts(acc.id).length;
    return {
      ...acc,
      messageCount: msgCount.count,
      safeContactCount: safeCount,
      lastScan: lastScan ? {
        date: lastScan.started_at,
        messagesScanned: lastScan.messages_scanned,
        alertsFound: lastScan.alerts_found,
        status: lastScan.status,
      } : null,
    };
  });
  res.json({ accounts });
});

app.post("/api/accounts", async (req, res) => {
  const { name, childName, childAge } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  const { accountId, connector } = await createAccount(name, childName, childAge);

  // Wait for QR or ready
  const result = await new Promise<any>((resolve) => {
    connector.on("qr", async (qr: string) => {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 256 });
      resolve({ accountId, status: "qr", qrDataUrl });
    });
    connector.on("ready", () => {
      resolve({ accountId, status: "ready" });
    });
    setTimeout(() => resolve({ accountId, status: "waiting" }), 15000);
  });

  res.json(result);
});

app.get("/api/accounts/:id/status", async (req, res) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: "Account not found" });

  const msgCount = queries.getMessageCount.get(account.id) as { count: number };
  const contacts = getContacts(account.id);

  res.json({
    ...account,
    messageCount: msgCount.count,
    contactCount: contacts.length,
  });
});

app.delete("/api/accounts/:id", async (req, res) => {
  await deleteAccount(req.params.id);
  res.json({ ok: true });
});

// ── Safe Contacts ──

app.get("/api/accounts/:id/safe-contacts", (req, res) => {
  const safe = getSafeContacts(req.params.id);
  res.json({ safeContacts: safe });
});

app.post("/api/accounts/:id/safe-contacts", (req, res) => {
  const { phone, name, relationship } = req.body;
  if (!phone) return res.status(400).json({ error: "phone required" });
  const jid = phone.includes("@") ? phone : `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
  addSafeContact(req.params.id, jid, name || phone, relationship || "family");
  res.json({ ok: true, jid });
});

app.delete("/api/accounts/:id/safe-contacts/:jid", (req, res) => {
  removeSafeContact(req.params.id, req.params.jid);
  res.json({ ok: true });
});

// ── Contacts & Groups ──

app.get("/api/accounts/:id/contacts", (req, res) => {
  const contacts = getContacts(req.params.id);
  const safe = new Set(getSafeContacts(req.params.id).map((s: any) => s.jid));
  res.json({
    contacts: contacts.map((c: any) => ({ ...c, isSafe: safe.has(c.jid) })),
  });
});

// ── Scan ──

app.post("/api/accounts/:id/scan", async (req, res) => {
  const account = getAccount(req.params.id);
  if (!account) return res.status(404).json({ error: "Account not found" });

  // Ensure connected
  if (account.status !== "ready") {
    const connector = await getConnector(req.params.id);
    if (!connector) return res.status(500).json({ error: "Cannot connect" });
    if (!connector.isReady()) {
      await new Promise<void>((resolve) => {
        connector.on("ready", () => resolve());
        setTimeout(() => resolve(), 30000);
      });
    }
  }

  try {
    const result = await scanAccount(req.params.id, (msg) => {
      console.log(`[scan ${req.params.id}] ${msg}`);
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Alerts ──

app.get("/api/accounts/:id/alerts", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const alerts = queries.getAlerts.all(req.params.id, limit);
  res.json({ alerts });
});

app.get("/api/accounts/:id/alerts/new", (req, res) => {
  const alerts = queries.getNewAlerts.all(req.params.id);
  res.json({ alerts });
});

app.patch("/api/alerts/:id", (req, res) => {
  const { status } = req.body;
  if (!["read", "handled", "dismissed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  queries.updateAlertStatus.run(status, parseInt(req.params.id));
  res.json({ ok: true });
});

// ── Scan History ──

app.get("/api/accounts/:id/scans", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const scans = queries.getScanHistory.all(req.params.id, limit);
  res.json({ scans });
});

// ── Start ──

app.listen(PORT, () => {
  console.log(`\n🛡️  Kids Monitor API running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET    /api/accounts                    — list accounts`);
  console.log(`  POST   /api/accounts                    — create + pair`);
  console.log(`  POST   /api/accounts/:id/scan           — run scan`);
  console.log(`  GET    /api/accounts/:id/alerts          — get alerts`);
  console.log(`  GET    /api/accounts/:id/contacts        — get contacts`);
  console.log(`  POST   /api/accounts/:id/safe-contacts   — add safe contact`);
  console.log(`  GET    /api/accounts/:id/scans            — scan history\n`);
});
