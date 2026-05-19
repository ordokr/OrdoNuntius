/**
 * Push-notification slice of `useEmailStore`. Stage 5 of the slice-split
 * refactor. Owns three state fields:
 *   - `isPushConnected`: JMAP push channel up?
 *   - `lastPushUpdate`: timestamp of last received state change (debug
 *     hook for "is push actually working?")
 *   - `newEmailNotification`: the most recent Email that should trigger
 *     a toast/sound (cleared by the consuming toast component)
 *
 * And five actions. `handleStateChange` is the heavy fan-out: a JMAP
 * push frame can change Email / Mailbox / Calendar / CalendarEvent /
 * SieveScript, and each one triggers a different downstream refresh
 * (some on this store, some via dynamic imports of the calendar / task /
 * filter stores). Putting the fan-out in its own slice keeps the core
 * slice from carrying knowledge about every other store.
 *
 * `refreshCurrentMailbox` is the per-push refetcher. It honors the
 * active search/query (so a push doesn't silently replace a filtered
 * list with an unfiltered one) and merges into the existing emails
 * list (so the virtual list doesn't shrink-then-reload on every push).
 * Called from `handleStateChange` AND from the core batch ops, so it
 * lives in the union but is invoked across slice boundaries — that's
 * fine, `get()` returns the composed store.
 */

import { type StateCreator } from "zustand";
import type { Email, Mailbox, StateChange } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { SearchFilters, buildJMAPFilter, isFilterEmpty } from "@/lib/jmap/search-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useCalendarStore } from "@/stores/calendar-store";
import { mailboxByIdLookup } from "@/stores/email-slices/_helpers";

// Fast equality for `keywords: Record<string, boolean>`. Avoids the
// JSON.stringify pair previously used in refreshCurrentMailbox — that
// allocated two strings per email per push and didn't short-circuit on
// size mismatch. Email.keywords typically holds 0-6 entries so this is
// dominated by the size check.
//
// Walk `a` once: compare each value against `b` (b[k] is undefined when b
// lacks k → mismatch). Then count `b` to confirm same size. Drops both
// `Object.keys` allocations — every push event compares N emails, so the
// keys-array churn adds up under heavy server activity.
function keywordsEqual(
  a: Record<string, boolean> = {},
  b: Record<string, boolean> = {},
): boolean {
  let aLen = 0;
  for (const k in a) {
    aLen++;
    if (a[k] !== b[k]) return false;
  }
  let bLen = 0;
  for (const _ in b) bLen++;
  return aLen === bLen;
}

export interface PushSlice {
  isPushConnected: boolean;
  lastPushUpdate: number | null;
  newEmailNotification: Email | null;
  setPushConnected: (connected: boolean) => void;
  handleStateChange: (change: StateChange, client: IJMAPClient) => Promise<void>;
  refreshCurrentMailbox: (client: IJMAPClient) => Promise<void>;
  handleNewEmailNotification: (email: Email) => void;
  clearNewEmailNotification: () => void;
}

export const createPushSlice: StateCreator<
  PushSlice & {
    selectedMailbox: string;
    mailboxes: Mailbox[];
    emails: Email[];
    hasMoreEmails: boolean;
    totalEmails: number;
    error: string | null;
    searchQuery: string;
    searchFilters: SearchFilters;
    fetchMailboxes: (client: IJMAPClient) => Promise<void>;
    fetchTagCounts: (client: IJMAPClient) => Promise<void>;
  },
  [],
  [],
  PushSlice
> = (set, get) => ({
  isPushConnected: false,
  lastPushUpdate: null,
  newEmailNotification: null,

  setPushConnected: (connected) => {
    set({ isPushConnected: connected });
  },

  handleStateChange: async (change, client) => {
    try {
      set({ lastPushUpdate: Date.now() });

      const accountId = client.getAccountId();
      const accountChanges = change.changed[accountId];
      if (!accountChanges) return;

      // Build the fan-out as a list of independent tasks, then run them in
      // parallel. Email refresh writes emails/totalEmails; Mailbox refresh
      // writes mailboxes; calendar/filter writes hit other stores entirely.
      // No write contention between them, so a push frame reporting multiple
      // change types completes in max(t) instead of sum(t).
      const tasks: Promise<unknown>[] = [];

      if (accountChanges.Email) {
        tasks.push(get().refreshCurrentMailbox(client));
        // fetchTagCounts already runs as fire-and-forget; keep it that way.
        get().fetchTagCounts(client);
      }

      if (accountChanges.Mailbox) {
        tasks.push(get().fetchMailboxes(client));
      }

      // Calendar / CalendarEvent / SieveScript fan-out into other stores.
      // Dynamic imports avoid a circular-import chain at module-load time
      // (those stores can import from this one indirectly).
      if (accountChanges.Calendar || accountChanges.CalendarEvent) {
        tasks.push((async () => {
          const calendarStore = useCalendarStore.getState();
          if (!calendarStore.supportsCalendar) return;
          calendarStore.fetchCalendars(client);
          const { dateRange, selectedCalendarIds } = calendarStore;
          if (dateRange && selectedCalendarIds.length > 0) {
            calendarStore.fetchEvents(client, dateRange.start, dateRange.end);
          }
          const { useTaskStore } = await import('@/stores/task-store');
          const taskStore = useTaskStore.getState();
          if (taskStore.tasks.length > 0 || calendarStore.viewMode === 'tasks') {
            taskStore.fetchTasks(client);
          }
        })());
      }

      if (accountChanges.SieveScript) {
        tasks.push((async () => {
          const { useFilterStore } = await import('@/stores/filter-store');
          const filterStore = useFilterStore.getState();
          if (filterStore.isSupported) {
            filterStore.fetchFilters(client).catch(err => {
              console.error('Failed to refresh filters:', err);
            });
          }
        })());
      }

      // allSettled: one fan-out task failing shouldn't strand the others.
      // Each task already handles its own errors (refresh* swallows for
      // background-refresh UX, fan-outs to other stores log+continue).
      await Promise.allSettled(tasks);
    } catch (error) {
      console.error('Failed to handle state change:', error);
      set({
        error: error instanceof Error ? error.message : "Failed to handle push notification",
      });
    }
  },

  refreshCurrentMailbox: async (client) => {
    const { selectedMailbox } = get();
    if (!selectedMailbox) return;

    try {
      const mailboxes = get().mailboxes;
      const mailbox = mailboxByIdLookup(mailboxes).get(selectedMailbox);
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;
      const jmapMailboxId = mailbox?.originalId || selectedMailbox;
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;

      // Honor active filters/query so a background refresh doesn't replace
      // a filtered list with an unfiltered one.
      const { searchQuery, searchFilters } = get();
      const hasFilters = !isFilterEmpty(searchFilters);

      const result = (hasFilters || searchQuery)
        ? await client.advancedSearchEmails(buildJMAPFilter(searchQuery, searchFilters, jmapMailboxId), accountId, emailsPerPage, 0)
        : await client.getEmails(jmapMailboxId, accountId, emailsPerPage, 0);

      const currentEmails = get().emails;

      // Only notify for genuinely new incoming mail in the Inbox. Without
      // these guards the toast/sound also fires when sending, saving
      // drafts, or moving/deleting the top message in any mailbox.
      const newFirst = result.emails[0];
      if (
        newFirst &&
        mailbox?.role === 'inbox' &&
        !currentEmails.some(e => e.id === newFirst.id)
      ) {
        get().handleNewEmailNotification(newFirst);
      }

      // Merge the refreshed first page with the existing loaded emails so
      // already-loaded pages aren't discarded (would cause the virtual
      // list to shrink then rapidly re-load — visible "scroll bounce").
      // Single-pass build: drops the `[...result.emails]` spread (one array
      // allocation) and the `result.emails.map(e => e.id)` ids-array
      // (another). Push + Set.add in lockstep.
      const merged: Email[] = [];
      const mergedIds = new Set<string>();
      for (const e of result.emails) {
        merged.push(e);
        mergedIds.add(e.id);
      }
      for (const email of currentEmails) {
        if (mergedIds.has(email.id)) continue;
        merged.push(email);
        mergedIds.add(email.id);
      }

      // Skip the state update entirely when nothing changed — avoids a
      // wave of useless re-renders across every subscribed component.
      // Was: `JSON.stringify(curr.keywords) !== JSON.stringify(email.keywords)`
      // — O(K log K + serialize cost) per email × N emails on every push.
      // Direct equality on the Record<string, boolean> is O(K) with an
      // early-exit on size mismatch.
      const hasChanged =
        currentEmails.length !== merged.length ||
        merged.some((email, i) => {
          const curr = currentEmails[i];
          if (!curr) return true;
          return (
            curr.id !== email.id ||
            curr.threadId !== email.threadId ||
            !keywordsEqual(curr.keywords, email.keywords)
          );
        });

      if (hasChanged) {
        set({
          emails: merged,
          hasMoreEmails: merged.length < (result.total || 0),
          totalEmails: result.total,
        });
      }
    } catch (error) {
      console.error('Failed to refresh current mailbox:', error);
      // Background refresh — don't surface error to the UI.
    }
  },

  handleNewEmailNotification: (email) => {
    set({ newEmailNotification: email });
  },

  clearNewEmailNotification: () => {
    set({ newEmailNotification: null });
  },
});
