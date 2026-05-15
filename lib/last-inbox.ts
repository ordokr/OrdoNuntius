// Tiny localStorage cache of the most-recently-resolved inbox mailbox ID,
// keyed by JMAP accountId. Read on cold-load by email-store.prefetchInitialData
// so Email/query can fire in parallel with Mailbox/get instead of after it
// — saving one full JMAP roundtrip on every login after the first.
//
// The value is treated as a hint: if Mailbox/get later reports a different
// inbox ID (e.g. account switch, mailbox deleted, role reassignment), the
// prefetch path re-issues Email/query against the correct ID and discards
// the speculative result.

const STORAGE_KEY = "ordo:lastInbox:v1";

type Cache = Record<string, string>;

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
    // quota or private-mode — best-effort
  }
}

export function getLastInbox(accountId: string): string | null {
  if (!accountId) return null;
  const cache = readCache();
  return cache[accountId] ?? null;
}

export function setLastInbox(accountId: string, mailboxId: string): void {
  if (!accountId || !mailboxId) return;
  const cache = readCache();
  if (cache[accountId] === mailboxId) return;
  cache[accountId] = mailboxId;
  writeCache(cache);
}

export function clearLastInbox(accountId?: string): void {
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
