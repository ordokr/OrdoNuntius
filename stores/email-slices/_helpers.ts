/**
 * Helpers shared by `useEmailStore` and its slices. Lives in the slices
 * folder (not in the core store) so slices can import without creating a
 * circular dependency back to the file that composes them.
 */

import type { Email, Mailbox } from "@/lib/jmap/types";

// id→mailbox lookup cached against the mailboxes array identity. The email
// store performs `mailboxes.find(mb => mb.id === X)` in 15+ actions per
// fetch/mutate — most of them on the hot path (batchDelete, batchMoveTo,
// move/markAsRead, etc.). WeakMap is built lazily on first lookup and
// freed via GC when the underlying array is replaced (zustand swaps the
// mailboxes array reference on every fetchMailboxes / role mutation).
const _mailboxByIdCache = new WeakMap<readonly Mailbox[], Map<string, Mailbox>>();
export function mailboxByIdLookup(mailboxes: readonly Mailbox[]): Map<string, Mailbox> {
  let m = _mailboxByIdCache.get(mailboxes);
  if (!m) {
    m = new Map<string, Mailbox>();
    for (const mb of mailboxes) m.set(mb.id, mb);
    _mailboxByIdCache.set(mailboxes, m);
  }
  return m;
}

interface SelectionState {
  emails: Email[];
  selectedEmail: Email | null;
}

/**
 * After removing one or more emails from the list, pick the next email
 * to select. Tries the email immediately after the removed selection
 * first (continue-reading-down behavior), then walks backwards if no
 * subsequent candidate exists. Returns null when nothing else is left.
 */
export function getNextSelectedEmailAfterRemoval(
  state: SelectionState,
  removedEmailIds: Set<string>,
): Email | null {
  if (!state.selectedEmail || !removedEmailIds.has(state.selectedEmail.id)) {
    return state.selectedEmail;
  }

  const idx = state.emails.findIndex(e => e.id === state.selectedEmail?.id);
  if (idx === -1) return null;

  for (let i = idx + 1; i < state.emails.length; i++) {
    const candidate = state.emails[i];
    if (!removedEmailIds.has(candidate.id)) return candidate;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = state.emails[i];
    if (!removedEmailIds.has(candidate.id)) return candidate;
  }
  return null;
}

export function getNextSelectedEmail(
  state: SelectionState,
  removedEmailId: string,
): Email | null {
  return getNextSelectedEmailAfterRemoval(state, new Set([removedEmailId]));
}
