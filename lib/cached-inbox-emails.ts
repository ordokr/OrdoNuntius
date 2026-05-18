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
import { createAccountKeyedCache } from "@/lib/account-keyed-cache";

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

const cache = createAccountKeyedCache<CachedInbox>("ordo:inboxEmails:v1");

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
  return rest as SlimEmail;
}

export function getCachedInbox(accountId: string): CachedInbox | null {
  return cache.get(accountId);
}

export function setCachedInbox(
  accountId: string,
  mailboxId: string,
  emails: Email[],
  total: number,
  hasMore: boolean,
): void {
  if (!mailboxId) return;
  cache.set(accountId, {
    accountId,
    mailboxId,
    emails: emails.slice(0, MAX_EMAILS).map(slim),
    total,
    hasMore,
    savedAt: Date.now(),
  });
}

export function clearCachedInbox(accountId?: string): void {
  cache.clear(accountId);
}
