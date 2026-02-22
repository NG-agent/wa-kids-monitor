import { queries } from "./db";
import { WAConnector } from "./wa-connector";
import { randomBytes } from "crypto";

const connectors = new Map<string, WAConnector>();

// ── Parent Management ──

export interface Parent {
  id: string;
  phone: string;
  name: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Normalize Israeli phone number to +972 format.
 */
export function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, "");
  if (p.startsWith("0")) p = "+972" + p.slice(1);
  if (p.startsWith("972") && !p.startsWith("+")) p = "+" + p;
  if (!p.startsWith("+")) p = "+" + p;
  return p;
}

/**
 * Register or retrieve a parent by phone number.
 */
export function getOrCreateParent(phone: string, name?: string): Parent {
  const normalized = normalizePhone(phone);
  const existing = queries.getParentByPhone.get(normalized) as Parent | undefined;
  if (existing) {
    if (name && !existing.name) queries.updateParentName.run(name, existing.id);
    return existing;
  }

  const id = `parent_${randomBytes(4).toString("hex")}`;
  queries.createParent.run(id, normalized, name || null);
  return queries.getParent.get(id) as Parent;
}

/**
 * Get parent by ID.
 */
export function getParent(parentId: string): Parent | null {
  return (queries.getParent.get(parentId) as Parent) || null;
}

/**
 * Get parent by phone.
 */
export function getParentByPhone(phone: string): Parent | null {
  return (queries.getParentByPhone.get(normalizePhone(phone)) as Parent) || null;
}

/**
 * Get all children for a parent.
 */
export function getChildrenForParent(parentId: string): Account[] {
  return queries.getChildrenForParent.all(parentId) as Account[];
}

/**
 * Check if parent has access to a child.
 */
export function isParentOfChild(parentId: string, accountId: string): boolean {
  return !!queries.isParentOfChild.get(parentId, accountId);
}

/**
 * Get all parents for a child.
 */
export function getParentsForChild(accountId: string): (Parent & { role: string })[] {
  return queries.getParentsForChild.all(accountId) as any[];
}

/**
 * Invite a co-parent by phone number.
 */
export function inviteCoParent(accountId: string, invitedByParentId: string, invitedPhone: string): string {
  const normalized = normalizePhone(invitedPhone);
  const inviteId = `inv_${randomBytes(6).toString("hex")}`;
  queries.createInvite.run(inviteId, accountId, invitedByParentId, normalized);

  // If invited parent already exists, auto-check pending invites
  const existingParent = queries.getParentByPhone.get(normalized) as Parent | undefined;
  if (existingParent) {
    // They can accept via the portal
  }

  return inviteId;
}

/**
 * Accept a co-parent invite. Called when the invited parent opens their link.
 */
export function acceptInvite(inviteId: string, parentId: string): boolean {
  const invite = queries.getInvite.get(inviteId) as any;
  if (!invite) return false;

  queries.acceptInvite.run(inviteId);
  queries.linkParentChild.run(parentId, invite.account_id, "coparent");
  return true;
}

/**
 * Check and auto-accept pending invites for a phone number.
 */
export function processPendingInvites(parentId: string, phone: string): number {
  const normalized = normalizePhone(phone);
  const pending = queries.getInvitesByPhone.all(normalized) as any[];
  let accepted = 0;
  for (const invite of pending) {
    queries.acceptInvite.run(invite.id);
    queries.linkParentChild.run(parentId, invite.account_id, "coparent");
    accepted++;
  }
  return accepted;
}

export interface Account {
  id: string;
  name: string;
  child_name: string | null;
  child_birthdate: string | null;
  child_gender: string | null;
  phone: string | null;
  scan_code: string | null;
  scan_count: number;
  status: string;
  tos_accepted: number;
  tos_accepted_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Generate a unique 6-digit personal scan code.
 */
function generateScanCode(): string {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const existing = queries.getAccountByScanCode.get(code);
    if (!existing) return code;
  }
  // Fallback: 8-char hex
  return randomBytes(4).toString("hex");
}

/**
 * Calculate age from birthdate string (YYYY-MM-DD)
 */
export function calculateAge(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Create a new child account and link to parent.
 */
export async function createAccount(
  name: string,
  childName?: string,
  childBirthdate?: string,
  childGender?: string,
  parentId?: string
): Promise<{ accountId: string; connector: WAConnector }> {
  const id = `kid_${randomBytes(4).toString("hex")}`;

  queries.createAccount.run(id, name, childName || null, childBirthdate || null, childGender || null);

  // Generate unique 6-digit scan code
  const scanCode = generateScanCode();
  queries.updateScanCode.run(scanCode, id);

  // Link to parent
  if (parentId) {
    queries.linkParentChild.run(parentId, id, "owner");
  }

  const connector = new WAConnector(id);
  connectors.set(id, connector);

  await connector.connect();

  return { accountId: id, connector };
}

/**
 * Get or reconnect an existing account
 */
export async function getConnector(accountId: string): Promise<WAConnector | null> {
  const account = queries.getAccount.get(accountId) as Account | undefined;
  if (!account) return null;

  let connector = connectors.get(accountId);
  if (connector && connector.isReady()) return connector;

  // Reconnect
  connector = new WAConnector(accountId);
  connectors.set(accountId, connector);
  await connector.connect();

  return connector;
}

/**
 * Get connector if already connected (no reconnect)
 */
export function getActiveConnector(accountId: string): WAConnector | null {
  return connectors.get(accountId) || null;
}

/**
 * List all accounts
 */
export function listAccounts(): Account[] {
  return queries.listAccounts.all() as Account[];
}

/**
 * Get account details
 */
export function getAccount(accountId: string): Account | null {
  return (queries.getAccount.get(accountId) as Account) || null;
}

/**
 * Delete account and disconnect
 */
export async function deleteAccount(accountId: string): Promise<void> {
  const connector = connectors.get(accountId);
  if (connector) {
    await connector.disconnect();
    connectors.delete(accountId);
  }
  queries.deleteAccount.run(accountId);
}

/**
 * Full logout — disconnect + delete WhatsApp session.
 * Used after free-tier scan to remove the link for security.
 */
export async function logoutAccount(accountId: string): Promise<void> {
  const connector = connectors.get(accountId);
  if (connector) {
    await connector.logout();
    connectors.delete(accountId);
  }
}

/**
 * Accept TOS for account
 */
export function acceptTos(accountId: string): void {
  queries.updateAccountTos.run(accountId);
}

/**
 * Add safe contacts for an account
 */
export function addSafeContact(
  accountId: string,
  jid: string,
  name: string,
  relationship: string = "family"
): void {
  queries.addSafeContact.run(accountId, jid, name, relationship);
}

/**
 * Remove safe contact
 */
export function removeSafeContact(accountId: string, jid: string): void {
  queries.removeSafeContact.run(accountId, jid);
}

/**
 * Get safe contacts
 */
export function getSafeContacts(accountId: string): any[] {
  return queries.getSafeContacts.all(accountId);
}

/**
 * Check if a chat should be scanned (not safe)
 */
export function shouldScanChat(accountId: string, chatJid: string): boolean {
  // Private chat with safe contact → skip
  if (!chatJid.endsWith("@g.us")) {
    const isSafe = queries.isSafeContact.get(accountId, chatJid);
    return !isSafe;
  }
  // Group containing a safe contact → skip
  const hasSafe = queries.groupHasSafeContact.get(accountId, chatJid);
  return !hasSafe;
}

/**
 * Get all contacts for account
 */
export function getContacts(accountId: string): any[] {
  return queries.getContacts.all(accountId);
}

/**
 * Get all groups for account
 */
export function getGroups(accountId: string): any[] {
  return queries.getGroups.all(accountId);
}

// ── Family keyword patterns for safe contact suggestion ──

const FAMILY_KEYWORDS: { pattern: RegExp; relationship: string }[] = [
  { pattern: /\bאמא\b|^אמא\s|מאמא|mama|^mom$/i, relationship: "אמא" },
  { pattern: /\bאבא\b|^אבא\s|פאפא|papa|^dad$/i, relationship: "אבא" },
  { pattern: /\bסבתא\b|גרנדמא|grandma/i, relationship: "סבתא" },
  { pattern: /\bסבא\b|גרנדפא|grandpa/i, relationship: "סבא" },
  { pattern: /\bדודה\b|^דודה\s/i, relationship: "דודה" },
  { pattern: /\bדוד\b|^דוד\s/i, relationship: "דוד" },
  { pattern: /\bאחות\b|^אחות\s/i, relationship: "אחות" },
  { pattern: /\bאח\b|^אח\s/i, relationship: "אח" },
  { pattern: /\bמורה\b|^המורה\s/i, relationship: "מורה" },
];

export interface SafeContactSuggestion {
  jid: string;
  name: string;
  messageCount: number;
  suggestedRelationship: string | null;
  autoSafe: boolean;
}

/**
 * Suggest safe contacts based on name patterns and message frequency
 */
export function suggestSafeContacts(accountId: string): SafeContactSuggestion[] {
  const contacts = queries.getContactsSortedByMessages.all(accountId, 30) as any[];
  const alreadySafe = new Set(getSafeContacts(accountId).map((s: any) => s.jid));

  const suggestions: SafeContactSuggestion[] = [];

  for (const contact of contacts) {
    if (alreadySafe.has(contact.jid)) continue;
    if (contact.message_count < 1) continue;

    const name = contact.name || "";
    let suggestedRelationship: string | null = null;
    let autoSafe = false;

    for (const { pattern, relationship } of FAMILY_KEYWORDS) {
      if (pattern.test(name)) {
        suggestedRelationship = relationship;
        autoSafe = true;
        break;
      }
    }

    suggestions.push({
      jid: contact.jid,
      name: name || contact.jid.split("@")[0],
      messageCount: contact.message_count,
      suggestedRelationship,
      autoSafe,
    });
  }

  // Sort: auto-safe first, then by message count
  suggestions.sort((a, b) => {
    if (a.autoSafe !== b.autoSafe) return a.autoSafe ? -1 : 1;
    return b.messageCount - a.messageCount;
  });

  return suggestions.slice(0, 15);
}
