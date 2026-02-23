import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "monitor.db"));

// WAL mode for better concurrent reads
db.pragma("journal_mode = WAL");

// ── Schema ──

db.exec(`
  -- Parents: phone number is the identity
  CREATE TABLE IF NOT EXISTS parents (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  -- Children (was "accounts" — kept as accounts for backward compat with scanner/connector)
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    child_name TEXT,
    child_birthdate TEXT,
    child_gender TEXT,
    phone TEXT,
    scan_code TEXT UNIQUE,
    scan_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'disconnected',
    tos_accepted INTEGER DEFAULT 0,
    tos_accepted_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  -- Many-to-many: parents ↔ children
  CREATE TABLE IF NOT EXISTS parent_children (
    parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'owner',
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (parent_id, account_id)
  );

  -- Co-parent invites
  CREATE TABLE IF NOT EXISTS parent_invites (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    invited_by TEXT NOT NULL REFERENCES parents(id),
    invited_phone TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch()),
    accepted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS safe_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    name TEXT,
    relationship TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(account_id, jid)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    name TEXT,
    is_group INTEGER DEFAULT 0,
    member_count INTEGER DEFAULT 0,
    first_seen INTEGER DEFAULT (unixepoch()),
    last_seen INTEGER DEFAULT (unixepoch()),
    message_count INTEGER DEFAULT 0,
    UNIQUE(account_id, jid)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    msg_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    chat_name TEXT,
    sender_jid TEXT,
    sender_name TEXT,
    from_child INTEGER DEFAULT 0,
    body TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    media_type TEXT,
    media_path TEXT,
    media_analyzed INTEGER DEFAULT 0,
    media_analysis TEXT,
    transcription TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(account_id, msg_id)
  );

  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'running',
    messages_scanned INTEGER DEFAULT 0,
    messages_new INTEGER DEFAULT 0,
    chats_scanned INTEGER DEFAULT 0,
    chats_skipped INTEGER DEFAULT 0,
    alerts_found INTEGER DEFAULT 0,
    model TEXT,
    cost REAL DEFAULT 0,
    started_at INTEGER DEFAULT (unixepoch()),
    completed_at INTEGER,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    scan_id INTEGER REFERENCES scans(id),
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    chat_jid TEXT,
    chat_name TEXT,
    summary TEXT NOT NULL,
    recommendation TEXT,
    confidence REAL DEFAULT 0,
    context_messages TEXT,
    status TEXT DEFAULT 'new',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS scan_cursors (
    account_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    last_msg_timestamp INTEGER DEFAULT 0,
    last_msg_id TEXT,
    messages_total INTEGER DEFAULT 0,
    PRIMARY KEY (account_id, chat_jid)
  );

  -- Per-chat risk flags: tracks cumulative risk per category
  CREATE TABLE IF NOT EXISTS chat_risk_flags (
    account_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    category TEXT NOT NULL,
    risk_level TEXT DEFAULT 'none',
    hit_count INTEGER DEFAULT 0,
    max_severity TEXT DEFAULT 'low',
    max_confidence REAL DEFAULT 0,
    first_detected INTEGER DEFAULT (unixepoch()),
    last_detected INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (account_id, chat_jid, category)
  );

  CREATE INDEX IF NOT EXISTS idx_chat_risk_account ON chat_risk_flags(account_id);

  -- Individual risk events log — every detection saved with timestamp
  CREATE TABLE IF NOT EXISTS risk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    chat_name TEXT,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    summary TEXT,
    scan_id INTEGER REFERENCES scans(id),
    detected_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_risk_events_account ON risk_events(account_id, detected_at DESC);
  CREATE INDEX IF NOT EXISTS idx_risk_events_chat ON risk_events(account_id, chat_jid, detected_at DESC);

  CREATE TABLE IF NOT EXISTS parent_tokens (
    token TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER,
    UNIQUE(parent_id)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT DEFAULT 'active',
    payment_method TEXT,
    payment_last4 TEXT,
    started_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER,
    UNIQUE(parent_id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    account_id TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    member_jid TEXT NOT NULL,
    PRIMARY KEY (account_id, group_jid, member_jid)
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_account ON group_members(account_id, group_jid);
  CREATE INDEX IF NOT EXISTS idx_messages_account_chat ON messages(account_id, chat_jid, timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_account_ts ON messages(account_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_alerts_account ON alerts(account_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
`);

// ── Prepared statements ──

export const queries = {
  // Parents
  createParent: db.prepare(`INSERT OR IGNORE INTO parents (id, phone, name) VALUES (?, ?, ?)`),
  getParent: db.prepare(`SELECT * FROM parents WHERE id = ?`),
  getParentByPhone: db.prepare(`SELECT * FROM parents WHERE phone = ?`),
  updateParentName: db.prepare(`UPDATE parents SET name = ?, updated_at = unixepoch() WHERE id = ?`),

  // Parent ↔ Children
  linkParentChild: db.prepare(`INSERT OR IGNORE INTO parent_children (parent_id, account_id, role) VALUES (?, ?, ?)`),
  unlinkParentChild: db.prepare(`DELETE FROM parent_children WHERE parent_id = ? AND account_id = ?`),
  getChildrenForParent: db.prepare(`
    SELECT a.* FROM accounts a
    INNER JOIN parent_children pc ON pc.account_id = a.id
    WHERE pc.parent_id = ?
    ORDER BY a.created_at
  `),
  getParentsForChild: db.prepare(`
    SELECT p.*, pc.role FROM parents p
    INNER JOIN parent_children pc ON pc.parent_id = p.id
    WHERE pc.account_id = ?
  `),
  isParentOfChild: db.prepare(`SELECT 1 FROM parent_children WHERE parent_id = ? AND account_id = ?`),

  // Co-parent invites
  createInvite: db.prepare(`INSERT INTO parent_invites (id, account_id, invited_by, invited_phone) VALUES (?, ?, ?, ?)`),
  getInvite: db.prepare(`SELECT * FROM parent_invites WHERE id = ? AND status = 'pending'`),
  getInvitesByPhone: db.prepare(`SELECT * FROM parent_invites WHERE invited_phone = ? AND status = 'pending'`),
  getInvitesForChild: db.prepare(`SELECT * FROM parent_invites WHERE account_id = ? ORDER BY created_at DESC`),
  acceptInvite: db.prepare(`UPDATE parent_invites SET status = 'accepted', accepted_at = unixepoch() WHERE id = ?`),
  rejectInvite: db.prepare(`UPDATE parent_invites SET status = 'rejected' WHERE id = ?`),

  // Accounts (children)
  createAccount: db.prepare(`INSERT INTO accounts (id, name, child_name, child_birthdate, child_gender) VALUES (?, ?, ?, ?, ?)`),
  getAccount: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
  getAccountByPhone: db.prepare(`SELECT * FROM accounts WHERE phone = ?`),
  hasMessagesFromJid: db.prepare(`SELECT 1 FROM messages WHERE sender_jid = ? AND from_child = 1 LIMIT 1`),
  listAccounts: db.prepare(`SELECT * FROM accounts ORDER BY created_at`),
  updateAccountStatus: db.prepare(`UPDATE accounts SET status = ?, updated_at = unixepoch() WHERE id = ?`),
  updateAccountTos: db.prepare(`UPDATE accounts SET tos_accepted = 1, tos_accepted_at = unixepoch() WHERE id = ?`),
  updateScanCode: db.prepare(`UPDATE accounts SET scan_code = ? WHERE id = ?`),
  getAccountByScanCode: db.prepare(`SELECT * FROM accounts WHERE scan_code = ?`),
  incrementScanCount: db.prepare(`UPDATE accounts SET scan_count = scan_count + 1 WHERE id = ?`),
  deleteAccount: db.prepare(`DELETE FROM accounts WHERE id = ?`),

  // Safe contacts
  addSafeContact: db.prepare(`INSERT OR IGNORE INTO safe_contacts (account_id, jid, name, relationship) VALUES (?, ?, ?, ?)`),
  removeSafeContact: db.prepare(`DELETE FROM safe_contacts WHERE account_id = ? AND jid = ?`),
  getSafeContacts: db.prepare(`SELECT * FROM safe_contacts WHERE account_id = ?`),
  isSafeContact: db.prepare(`SELECT 1 FROM safe_contacts WHERE account_id = ? AND jid = ?`),

  // Contacts
  upsertContact: db.prepare(`
    INSERT INTO contacts (account_id, jid, name, is_group, member_count, last_seen, message_count)
    VALUES (?, ?, ?, ?, ?, unixepoch(), 1)
    ON CONFLICT(account_id, jid) DO UPDATE SET
      name = COALESCE(excluded.name, name),
      is_group = excluded.is_group,
      member_count = COALESCE(excluded.member_count, member_count),
      last_seen = unixepoch(),
      message_count = message_count + 1
  `),
  getContacts: db.prepare(`SELECT * FROM contacts WHERE account_id = ? ORDER BY last_seen DESC`),
  getContactsSortedByMessages: db.prepare(`SELECT * FROM contacts WHERE account_id = ? AND is_group = 0 ORDER BY message_count DESC LIMIT ?`),
  getGroups: db.prepare(`SELECT * FROM contacts WHERE account_id = ? AND is_group = 1 ORDER BY last_seen DESC`),
  getNewContactsSince: db.prepare(`
    SELECT * FROM contacts
    WHERE account_id = ? AND is_group = 0 AND first_seen > ?
    ORDER BY first_seen DESC
  `),
  getNewGroupsSince: db.prepare(`
    SELECT * FROM contacts
    WHERE account_id = ? AND is_group = 1 AND first_seen > ?
    ORDER BY first_seen DESC
  `),

  // Parent tokens (magic links — per parent, not per child)
  createParentToken: db.prepare(`INSERT OR REPLACE INTO parent_tokens (token, parent_id, expires_at) VALUES (?, ?, ?)`),
  getParentToken: db.prepare(`SELECT * FROM parent_tokens WHERE token = ? AND (expires_at IS NULL OR expires_at > unixepoch())`),
  getTokenByParent: db.prepare(`SELECT * FROM parent_tokens WHERE parent_id = ?`),

  // Subscriptions (per parent — covers all their children)
  upsertSubscription: db.prepare(`
    INSERT INTO subscriptions (parent_id, plan, status, payment_method, payment_last4, expires_at)
    VALUES (?, ?, 'active', ?, ?, ?)
    ON CONFLICT(parent_id) DO UPDATE SET
      plan = excluded.plan, status = excluded.status,
      payment_method = excluded.payment_method, payment_last4 = excluded.payment_last4,
      expires_at = excluded.expires_at
  `),
  getSubscription: db.prepare(`SELECT * FROM subscriptions WHERE parent_id = ?`),

  // Group members
  upsertGroupMember: db.prepare(`INSERT OR IGNORE INTO group_members (account_id, group_jid, member_jid) VALUES (?, ?, ?)`),
  clearGroupMembers: db.prepare(`DELETE FROM group_members WHERE account_id = ? AND group_jid = ?`),
  getGroupMembers: db.prepare(`SELECT member_jid FROM group_members WHERE account_id = ? AND group_jid = ?`),
  groupHasSafeContact: db.prepare(`
    SELECT 1 FROM group_members gm
    INNER JOIN safe_contacts sc ON sc.account_id = gm.account_id AND sc.jid = gm.member_jid
    WHERE gm.account_id = ? AND gm.group_jid = ?
    LIMIT 1
  `),

  // Messages
  insertMessage: db.prepare(`
    INSERT OR IGNORE INTO messages (account_id, msg_id, chat_jid, chat_name, sender_jid, sender_name, from_child, body, timestamp, media_type, media_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateMediaPath: db.prepare(`UPDATE messages SET media_path = ? WHERE account_id = ? AND msg_id = ?`),
  updateMediaAnalysis: db.prepare(`UPDATE messages SET media_analyzed = 1, media_analysis = ? WHERE id = ?`),
  updateTranscription: db.prepare(`UPDATE messages SET transcription = ? WHERE id = ?`),
  getUnanalyzedMedia: db.prepare(`
    SELECT * FROM messages
    WHERE account_id = ? AND media_type IN ('image', 'video', 'audio') AND media_path IS NOT NULL AND media_analyzed = 0
    ORDER BY timestamp ASC
    LIMIT ?
  `),
  getUnanalyzedMediaForChat: db.prepare(`
    SELECT * FROM messages
    WHERE account_id = ? AND chat_jid = ? AND media_type IN ('image', 'video', 'audio') AND media_path IS NOT NULL AND media_analyzed = 0
    ORDER BY timestamp ASC
    LIMIT ?
  `),
  getMessagesSince: db.prepare(`
    SELECT * FROM messages
    WHERE account_id = ? AND chat_jid = ? AND timestamp > ?
    ORDER BY timestamp ASC
  `),
  getRecentMessages: db.prepare(`
    SELECT * FROM messages
    WHERE account_id = ? AND chat_jid = ? AND timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `),
  getNewMessagesForScan: db.prepare(`
    SELECT m.* FROM messages m
    LEFT JOIN scan_cursors sc ON sc.account_id = m.account_id AND sc.chat_jid = m.chat_jid
    WHERE m.account_id = ?
      AND m.timestamp > COALESCE(sc.last_msg_timestamp, 0)
    ORDER BY m.chat_jid, m.timestamp ASC
  `),
  getLastNMessages: db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE account_id = ? AND chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp ASC
  `),
  getDistinctChats: db.prepare(`
    SELECT DISTINCT chat_jid, MAX(chat_name) as chat_name, COUNT(*) as msg_count
    FROM messages WHERE account_id = ?
    GROUP BY chat_jid
    ORDER BY MAX(timestamp) DESC
  `),
  getMessageCount: db.prepare(`SELECT COUNT(*) as count FROM messages WHERE account_id = ?`),
  getLatestTimestamp: db.prepare(`SELECT MAX(timestamp) as ts FROM messages WHERE account_id = ? AND chat_jid = ?`),

  // Scan cursors
  upsertCursor: db.prepare(`
    INSERT INTO scan_cursors (account_id, chat_jid, last_msg_timestamp, last_msg_id, messages_total)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, chat_jid) DO UPDATE SET
      last_msg_timestamp = excluded.last_msg_timestamp,
      last_msg_id = excluded.last_msg_id,
      messages_total = messages_total + excluded.messages_total
  `),
  getCursor: db.prepare(`SELECT * FROM scan_cursors WHERE account_id = ? AND chat_jid = ?`),

  // Chat risk flags
  upsertRiskFlag: db.prepare(`
    INSERT INTO chat_risk_flags (account_id, chat_jid, category, risk_level, hit_count, max_severity, max_confidence, last_detected)
    VALUES (?, ?, ?, ?, 1, ?, ?, unixepoch())
    ON CONFLICT(account_id, chat_jid, category) DO UPDATE SET
      risk_level = CASE
        WHEN excluded.risk_level > risk_level THEN excluded.risk_level
        ELSE risk_level
      END,
      hit_count = hit_count + 1,
      max_severity = CASE
        WHEN excluded.max_severity > max_severity THEN excluded.max_severity
        ELSE max_severity
      END,
      max_confidence = MAX(max_confidence, excluded.max_confidence),
      last_detected = unixepoch()
  `),
  getRiskFlagsForChat: db.prepare(`SELECT * FROM chat_risk_flags WHERE account_id = ? AND chat_jid = ? ORDER BY last_detected DESC`),
  getRiskFlagsForAccount: db.prepare(`SELECT * FROM chat_risk_flags WHERE account_id = ? ORDER BY last_detected DESC`),
  getHighRiskChats: db.prepare(`
    SELECT chat_jid, category, risk_level, hit_count, max_severity, max_confidence, last_detected
    FROM chat_risk_flags
    WHERE account_id = ? AND risk_level IN ('high', 'critical')
    ORDER BY last_detected DESC
  `),
  clearRiskFlag: db.prepare(`DELETE FROM chat_risk_flags WHERE account_id = ? AND chat_jid = ? AND category = ?`),

  // Risk events (individual detection log)
  insertRiskEvent: db.prepare(`
    INSERT INTO risk_events (account_id, chat_jid, chat_name, category, severity, confidence, summary, scan_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getRiskEventsForAccount: db.prepare(`SELECT * FROM risk_events WHERE account_id = ? ORDER BY detected_at DESC LIMIT ?`),
  getRiskEventsForChat: db.prepare(`SELECT * FROM risk_events WHERE account_id = ? AND chat_jid = ? ORDER BY detected_at DESC LIMIT ?`),
  getRiskEventsForCategory: db.prepare(`SELECT * FROM risk_events WHERE account_id = ? AND category = ? ORDER BY detected_at DESC LIMIT ?`),
  getRiskEventsSince: db.prepare(`SELECT * FROM risk_events WHERE account_id = ? AND detected_at > ? ORDER BY detected_at DESC`),

  // Cleanup: delete processed messages (privacy — raw data not stored long-term)
  deleteProcessedMessages: db.prepare(`
    DELETE FROM messages
    WHERE account_id = ? AND chat_jid = ? AND timestamp <= ?
  `),
  // Keep only the last N messages per chat as context for next scan
  deleteMessagesKeepRecent: db.prepare(`
    DELETE FROM messages
    WHERE account_id = ? AND chat_jid = ? AND id NOT IN (
      SELECT id FROM messages
      WHERE account_id = ? AND chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    )
  `),
  // Delete media file references (actual files deleted separately)
  getMediaFilesForChat: db.prepare(`
    SELECT media_path FROM messages
    WHERE account_id = ? AND chat_jid = ? AND media_path IS NOT NULL
  `),

  // Scans
  createScan: db.prepare(`INSERT INTO scans (account_id, model) VALUES (?, ?) RETURNING id`),
  updateScan: db.prepare(`
    UPDATE scans SET status = ?, messages_scanned = ?, messages_new = ?,
    chats_scanned = ?, chats_skipped = ?, alerts_found = ?, cost = ?, completed_at = unixepoch(), error = ?
    WHERE id = ?
  `),
  getLastScan: db.prepare(`SELECT * FROM scans WHERE account_id = ? ORDER BY started_at DESC LIMIT 1`),
  getScanHistory: db.prepare(`SELECT * FROM scans WHERE account_id = ? ORDER BY started_at DESC LIMIT ?`),

  // Alerts
  createAlert: db.prepare(`
    INSERT INTO alerts (account_id, scan_id, severity, category, chat_jid, chat_name, summary, recommendation, confidence, context_messages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getAlerts: db.prepare(`SELECT * FROM alerts WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`),
  getNewAlerts: db.prepare(`SELECT * FROM alerts WHERE account_id = ? AND status = 'new' ORDER BY created_at DESC`),
  getAllNewAlerts: db.prepare(`SELECT * FROM alerts WHERE status = 'new' ORDER BY created_at DESC LIMIT ?`),
  updateAlertStatus: db.prepare(`UPDATE alerts SET status = ? WHERE id = ?`),
  getAlertById: db.prepare(`SELECT * FROM alerts WHERE id = ?`),
};

export default db;
