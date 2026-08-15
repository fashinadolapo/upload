/** Shared production constants for the wedding memory portal. */

export const COUPLE_NAMES = "Olanrewaju & Dolapo";

export const HASHTAGS = ["#morenikeji", "#dolan26", "#TheFashinas"] as const;

/** Only these Cognito emails may administer the vault. */
export const ADMIN_EMAILS = [
  "dolapofashina@gmail.com",
  "awoyinfaolanrewaju@gmail.com",
] as const;

/**
 * Shared bootstrap password for first vault access.
 * Never displayed in the UI. Forced change on first successful login.
 */
export const DEFAULT_ADMIN_PASSWORD = "dolan26";

export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

export const COLORS = {
  wine: "#6b0f1a",
  deepWine: "#4b0c14",
  champagne: "#f5e6c8",
  gold: "#d4af37",
  silver: "#c0c0c0",
} as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedAdminEmail(email: string) {
  return (ADMIN_EMAILS as readonly string[]).includes(normalizeEmail(email));
}
