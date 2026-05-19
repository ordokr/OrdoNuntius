import type { Email, Mailbox, UnifiedMailboxRole } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

export interface UnifiedAccountClient {
  accountId: string;
  accountLabel: string;
  client: IJMAPClient;
  mailboxes: Mailbox[];
}

export interface UnifiedFetchResult {
  emails: Email[];
  total: number;
  hasMore: boolean;
  errors: Map<string, string>; // accountId -> error message
}

export interface UnifiedMailboxCounts {
  role: UnifiedMailboxRole;
  unreadEmails: number;
  totalEmails: number;
}

const ALL_UNIFIED_ROLES: UnifiedMailboxRole[] = [
  'inbox', 'sent', 'drafts', 'trash', 'archive', 'junk',
];

/**
 * Finds the first mailbox matching the given role.
 */
export function findMailboxByRole(
  mailboxes: Mailbox[],
  role: UnifiedMailboxRole,
): Mailbox | undefined {
  return mailboxes.find((m) => m.role === role);
}

/**
 * Fetches emails from all accounts for a given unified role, merges and sorts
 * them by receivedAt descending. Per-account failures are collected in the
 * errors map while successful results are still returned.
 */
export async function fetchUnifiedEmails(
  accounts: UnifiedAccountClient[],
  role: UnifiedMailboxRole,
  limit: number,
  position: number,
): Promise<UnifiedFetchResult> {
  const errors = new Map<string, string>();

  // Build one fetch task per account, wrapping each in a catch so we can
  // track per-account errors while still using Promise.allSettled.
  type AccountResult = {
    account: UnifiedAccountClient;
    result: { emails: Email[]; total: number; hasMore: boolean };
  } | null;

  const promises = accounts.map(
    async (account): Promise<AccountResult> => {
      const mailbox = findMailboxByRole(account.mailboxes, role);
      if (!mailbox) return null;

      try {
        const result = await account.client.getEmails(
          mailbox.id,
          undefined,
          limit,
          position,
        );
        return { account, result };
      } catch (err) {
        errors.set(
          account.accountId,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }
    },
  );

  const results = await Promise.allSettled(promises);

  const mergedEmails: Email[] = [];
  let totalSum = 0;
  let anyHasMore = false;

  for (const outcome of results) {
    if (outcome.status !== 'fulfilled' || outcome.value === null) continue;

    const { account, result } = outcome.value;

    // Decorate + push in one walk. Was a separate decorate-loop followed by
    // `mergedEmails = mergedEmails.concat(result.emails)` per account, which
    // allocated a fresh accumulator array each iteration (O(N×total) realloc
    // cost overall). Single accumulator + .push amortizes to O(N).
    for (const email of result.emails) {
      email.accountId = account.accountId;
      email.accountLabel = account.accountLabel;
      mergedEmails.push(email);
    }

    totalSum += result.total;
    if (result.hasMore) {
      anyHasMore = true;
    }
  }

  // Sort merged emails by receivedAt descending. Schwartzian: parse each
  // receivedAt once instead of twice per comparison.
  const decorated = new Array(mergedEmails.length);
  for (let i = 0; i < mergedEmails.length; i++) {
    decorated[i] = { email: mergedEmails[i], ms: new Date(mergedEmails[i].receivedAt).getTime() };
  }
  decorated.sort((a, b) => b.ms - a.ms);
  for (let i = 0; i < decorated.length; i++) mergedEmails[i] = decorated[i].email;

  return {
    emails: mergedEmails,
    total: totalSum,
    hasMore: anyHasMore,
    errors,
  };
}

// Inverted aggregation: walk each account's mailboxes ONCE and route into
// per-role accumulators. Was 6 roles × N accounts × .find(O(M)) per call =
// 6×N×M comparisons. Now N×M with one Set membership check per mailbox.
// For 4 accounts × 30 mailboxes that's 120 visits vs 720 — fires every
// push notification via refreshUnifiedCounts.
const UNIFIED_ROLE_SET = new Set<string>(ALL_UNIFIED_ROLES);

interface RoleAccum { unread: number; total: number; found: boolean }
function aggregateRoles(accounts: UnifiedAccountClient[]): Map<UnifiedMailboxRole, RoleAccum> {
  const acc = new Map<UnifiedMailboxRole, RoleAccum>();
  for (const role of ALL_UNIFIED_ROLES) acc.set(role, { unread: 0, total: 0, found: false });
  for (const account of accounts) {
    for (const mailbox of account.mailboxes) {
      if (!mailbox.role || !UNIFIED_ROLE_SET.has(mailbox.role)) continue;
      const entry = acc.get(mailbox.role as UnifiedMailboxRole)!;
      entry.found = true;
      entry.unread += mailbox.unreadEmails;
      entry.total += mailbox.totalEmails;
    }
  }
  return acc;
}

/**
 * Aggregates unread and total email counts across all accounts for each
 * unified mailbox role. Only includes roles that exist in at least one account.
 */
export function fetchUnifiedMailboxCounts(
  accounts: UnifiedAccountClient[],
): UnifiedMailboxCounts[] {
  const acc = aggregateRoles(accounts);
  const counts: UnifiedMailboxCounts[] = [];
  for (const role of ALL_UNIFIED_ROLES) {
    const entry = acc.get(role)!;
    if (entry.found) counts.push({ role, unreadEmails: entry.unread, totalEmails: entry.total });
  }
  return counts;
}

/**
 * Returns the list of unified roles that exist in at least one account's
 * mailboxes.
 */
export function getUnifiedRoles(
  accounts: UnifiedAccountClient[],
): UnifiedMailboxRole[] {
  const acc = aggregateRoles(accounts);
  const roles: UnifiedMailboxRole[] = [];
  for (const role of ALL_UNIFIED_ROLES) {
    if (acc.get(role)!.found) roles.push(role);
  }
  return roles;
}
