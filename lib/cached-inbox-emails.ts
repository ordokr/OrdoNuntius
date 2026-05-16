// localStorage cache of the most-recently-fetched inbox page per JMAP
// accountId. Restored synchronously on the next login so the email list
// renders BEFORE any JMAP roundtrip completes — Gmail's "instant inbox"
// pattern. The fresh fetch always runs in parallel and replaces the
// cached emails when it lands; cached data is a perception shortcut, not
// the source of truth.
//
// Companion to lib/last-inbox.ts (which caches just the mailbox ID for
// the speculative-parallel JMAP fetch). This cache is bigger and covers
// the rendering critical path; both clear together on cache miss.

import type { Email } from "@/lib/jmap/types";

const STORAGE_KEY = "ordo:inboxEmails:v1";
const MAX_EMAILS = 50;

// Drop heavyweight fields. List rendering only needs metadata; the body
// fields are re-fetched lazily when the user clicks an email, and storing
// them would blow past the 5 MB localStorage budget after a few accounts.
type SlimEmail = Omit<
  Email,
  "textBody" | "htmlBody" | "bodyValues" | "attachments" | "headers" | "bodyStructure"
>;

export interface CachedInbox {
  accountId: string;
  mailboxId: string;
  emails: SlimEmail[];
  total: number;
  hasMore: boolean;
  savedAt: number;
}

type Cache = Record<string, CachedInbox>;

function readCache(): Cache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded or private mode — silent. We'll just miss the
    // instant-render benefit until next successful write.
  }
}

function slim(email: Email): SlimEmail {
  const {
    textBody: _t,
    htmlBody: _h,
    bodyValues: _bv,
    attachments: _a,
    headers: _hd,
    bodyStructure: _bs,
    ...rest
  } = email;
  void _t; void _h; void _bv; void _a; void _hd; void _bs;
  return rest as SlimEmail;
}

export function getCachedInbox(accountId: string): CachedInbox | null {
  if (!accountId) return null;
  const cache = readCache();
  return cache[accountId] ?? null;
}

export function setCachedInbox(
  accountId: string,
  mailboxId: string,
  emails: Email[],
  total: number,
  hasMore: boolean,
): void {
  if (!accountId || !mailboxId) return;
  const cache = readCache();
  cache[accountId] = {
    accountId,
    mailboxId,
    emails: emails.slice(0, MAX_EMAILS).map(slim),
    total,
    hasMore,
    savedAt: Date.now(),
  };
  writeCache(cache);
}

export function clearCachedInbox(accountId?: string): void {
  if (!accountId) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }
  const cache = readCache();
  if (!(accountId in cache)) return;
  delete cache[accountId];
  writeCache(cache);
}
