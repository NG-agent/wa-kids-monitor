import crypto from "crypto";
import { queries } from "./db";

/**
 * Generate or retrieve a magic link token for a parent.
 * One token per parent — covers all their children.
 */
export function getOrCreatePortalToken(parentId: string): string {
  const existing = queries.getTokenByParent.get(parentId) as any;
  if (existing) return existing.token;

  const token = crypto.randomBytes(24).toString("base64url");
  queries.createParentToken.run(token, parentId, null); // no expiry
  return token;
}

/**
 * Validate a portal token and return the parent ID.
 */
export function validatePortalToken(token: string): string | null {
  const row = queries.getParentToken.get(token) as any;
  return row?.parent_id || null;
}

/**
 * Build the portal URL for WhatsApp message.
 */
export function getPortalUrl(baseUrl: string, parentId: string): string {
  const token = getOrCreatePortalToken(parentId);
  return `${baseUrl}/portal/${token}`;
}
