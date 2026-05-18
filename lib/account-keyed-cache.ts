/**
 * Generic localStorage cache keyed by JMAP accountId.
 *
 * The cache is a flat `{ [accountId]: T }` map persisted under a single
 * `storageKey`. SSR-safe (`typeof window === "undefined"` short-circuits),
 * fault-tolerant (JSON parse failures / quota exceeded / private mode are
 * swallowed silently), and per-key untyped at the storage boundary —
 * callers are responsible for shape validation if they care.
 *
 * Both `lib/last-inbox.ts` and `lib/cached-inbox-emails.ts` are built on
 * this factory. Before extraction they each carried near-identical 30-line
 * read/write/clear scaffolds with the same SSR + try/catch boilerplate.
 */

export interface AccountKeyedCache<T> {
  /** Returns the cached value for an account, or null. */
  get(accountId: string): T | null;
  /** Writes the value. No-op on falsy accountId. Callers may pre-validate. */
  set(accountId: string, value: T): void;
  /** Clears one account's entry (when `accountId` given) or wipes the entire key. */
  clear(accountId?: string): void;
}

export function createAccountKeyedCache<T>(storageKey: string): AccountKeyedCache<T> {
  type CacheMap = Record<string, T>;

  function read(): CacheMap {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as CacheMap) : {};
    } catch {
      return {};
    }
  }

  function write(cache: CacheMap): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch {
      // Quota or private mode — best-effort. We just miss the cache benefit
      // until the next successful write.
    }
  }

  return {
    get(accountId) {
      if (!accountId) return null;
      return read()[accountId] ?? null;
    },
    set(accountId, value) {
      if (!accountId) return;
      const cache = read();
      cache[accountId] = value;
      write(cache);
    },
    clear(accountId) {
      if (!accountId) {
        if (typeof window === "undefined") return;
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
        return;
      }
      const cache = read();
      if (!(accountId in cache)) return;
      delete cache[accountId];
      write(cache);
    },
  };
}
