/**
 * Thread-expansion slice of `useEmailStore`. Stage 2 of the slice-split
 * refactor (after `unified.ts`). Owns three fields — `expandedThreadIds`,
 * `threadEmailsCache`, `isLoadingThread` — and the four actions that
 * mutate them.
 *
 * The cache is a bounded LRU: 64 most-recently-touched threads. Without
 * the cap, expanding many threads during one mailbox session grows the
 * Map until the next mailbox switch (which resets it via `selectMailbox`
 * in the core slice). 64 × ~50 emails × ~2KB ≈ 6 MB ceiling.
 *
 * Cross-slice writes from core actions still touch these fields:
 *   - `selectMailbox` / `selectKeyword` reset all three (clean slate per
 *     mailbox view).
 *   - `moveThreadToMailbox` removes the moved thread from both maps so
 *     the now-empty thread doesn't leave stale expansion state behind.
 * Those writes live with the core slice because they're part of larger
 * compound state transitions — the thread fields are just one piece.
 */

import { type StateCreator } from "zustand";
import type { Email, Mailbox } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { mailboxByIdLookup } from "@/stores/email-slices/_helpers";

const MAX_THREAD_CACHE = 64;

export interface ThreadSlice {
  expandedThreadIds: Set<string>;
  /** threadId -> full email list. Bounded LRU; see MAX_THREAD_CACHE. */
  threadEmailsCache: Map<string, Email[]>;
  /** threadId currently being fetched, or null. Single-flight guard. */
  isLoadingThread: string | null;
  toggleThreadExpansion: (threadId: string) => void;
  fetchThreadEmails: (client: IJMAPClient, threadId: string) => Promise<Email[]>;
  collapseAllThreads: () => void;
  updateThreadCache: (threadId: string, emails: Email[]) => void;
}

/**
 * Slice creator. `fetchThreadEmails` needs to read `selectedMailbox` +
 * `mailboxes` from the core slice to determine the accountId for shared
 * folders, so the StateCreator's union widens to include those two fields.
 */
export const createThreadSlice: StateCreator<
  ThreadSlice & {
    selectedMailbox: string;
    mailboxes: Mailbox[];
  },
  [],
  [],
  ThreadSlice
> = (set, get) => ({
  expandedThreadIds: new Set(),
  threadEmailsCache: new Map(),
  isLoadingThread: null,

  toggleThreadExpansion: (threadId) => {
    const { expandedThreadIds } = get();
    const next = new Set(expandedThreadIds);
    if (next.has(threadId)) {
      next.delete(threadId);
    } else {
      next.add(threadId);
    }
    set({ expandedThreadIds: next });
  },

  fetchThreadEmails: async (client, threadId) => {
    const { threadEmailsCache, selectedMailbox, mailboxes } = get();

    const cached = threadEmailsCache.get(threadId);
    if (cached && cached.length > 0) {
      return cached;
    }

    set({ isLoadingThread: threadId });

    try {
      const mailbox = mailboxByIdLookup(mailboxes).get(selectedMailbox);
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;

      const emails = await client.getThreadEmails(threadId, accountId);

      // Map iteration order is insertion order: delete-then-set moves the
      // entry to the end so the least-recently-touched key sits at the
      // front. When over capacity, drop from the front.
      const next = new Map(get().threadEmailsCache);
      next.delete(threadId);
      next.set(threadId, emails);
      while (next.size > MAX_THREAD_CACHE) {
        const oldest = next.keys().next().value;
        if (oldest === undefined) break;
        next.delete(oldest);
      }

      set({ threadEmailsCache: next, isLoadingThread: null });
      return emails;
    } catch (error) {
      console.error('Failed to fetch thread emails:', error);
      set({ isLoadingThread: null });
      return [];
    }
  },

  collapseAllThreads: () => {
    set({ expandedThreadIds: new Set(), isLoadingThread: null });
  },

  updateThreadCache: (threadId, emails) => {
    const next = new Map(get().threadEmailsCache);
    next.set(threadId, emails);
    set({ threadEmailsCache: next });
  },
});
