// Tiny localStorage cache of the most-recently-resolved inbox mailbox ID,
// keyed by JMAP accountId. Read on cold-load by email-store.prefetchInitialData
// so Email/query can fire in parallel with Mailbox/get instead of after it
// — saving one full JMAP roundtrip on every login after the first.
//
// The value is treated as a hint: if Mailbox/get later reports a different
// inbox ID (e.g. account switch, mailbox deleted, role reassignment), the
// prefetch path re-issues Email/query against the correct ID and discards
// the speculative result.

import { createAccountKeyedCache } from "@/lib/account-keyed-cache";

const cache = createAccountKeyedCache<string>("ordo:lastInbox:v1");

export function getLastInbox(accountId: string): string | null {
  return cache.get(accountId);
}

export function setLastInbox(accountId: string, mailboxId: string): void {
  if (!mailboxId) return;
  // Skip the write entirely if the value is unchanged — avoids a useless
  // JSON.stringify + setItem on every login when the cached inbox is still
  // the same one the server resolves to.
  if (cache.get(accountId) === mailboxId) return;
  cache.set(accountId, mailboxId);
}

export function clearLastInbox(accountId?: string): void {
  cache.clear(accountId);
}
