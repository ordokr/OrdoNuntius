/**
 * Unified-mailbox slice of `useEmailStore`. Stage 1 of the slice-split
 * refactor logged in the audit: the email store had grown to ~50
 * actions in one file. Each slice owns a disjoint piece of state +
 * the actions that mutate it. All slices compose into the same
 * zustand store so the consumer API (`useEmailStore(s => s.foo)`)
 * stays identical — no callsite changes.
 *
 * Why unified-mailbox first: it's the most isolated slice. Four
 * state fields (`isUnifiedView`, `unifiedRole`, `unifiedErrors`,
 * `unifiedCounts`), four actions, and the only cross-slice writes
 * are to the shared `emails` / `hasMoreEmails` / `totalEmails` /
 * `isLoading` fields which are owned by the core email slice and
 * intentionally shared (the "unified view" reuses the same email
 * list rendering machinery).
 */

import { type StateCreator } from "zustand";
import type { Email } from "@/lib/jmap/types";
import { fetchUnifiedEmails as fetchUnifiedEmailsLib, fetchUnifiedMailboxCounts, type UnifiedAccountClient, type UnifiedMailboxCounts } from "@/lib/unified-mailbox";
import type { UnifiedMailboxRole } from "@/lib/jmap/types";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Subset of `EmailStore` that this slice writes into. The slice
 * mutates fields owned by the core email slice (`emails`,
 * `hasMoreEmails`, `totalEmails`, `isLoading`, `isLoadingMore`,
 * `error`, `selectedKeyword`) — the union is intentional. zustand
 * composes slices into a single store so they share state.
 */
export interface UnifiedSlice {
  isUnifiedView: boolean;
  unifiedRole: UnifiedMailboxRole | null;
  /** accountId -> error message; populated by lib/unified-mailbox on per-account failures. */
  unifiedErrors: Map<string, string>;
  unifiedCounts: UnifiedMailboxCounts[];
  fetchUnifiedEmails: (accounts: UnifiedAccountClient[], role: UnifiedMailboxRole) => Promise<void>;
  loadMoreUnifiedEmails: (accounts: UnifiedAccountClient[]) => Promise<void>;
  refreshUnifiedCounts: (accounts: UnifiedAccountClient[]) => Promise<void>;
  exitUnifiedView: () => void;
}

/**
 * Slice creator. Takes only the subset of the store it needs, but is
 * typed against the full store so cross-slice reads (`get()`) and
 * cross-slice writes (`set()`) work as expected when this slice
 * spreads into the composed store.
 */
export const createUnifiedSlice: StateCreator<
  // The slice itself only sees state it cares about, but the
  // StateCreator's get/set are typed against the full composed store
  // so we can read isLoadingMore / hasMoreEmails / emails (from the
  // core slice) without a cast.
  UnifiedSlice & {
    isLoading: boolean;
    isLoadingMore: boolean;
    hasMoreEmails: boolean;
    totalEmails: number;
    emails: Email[];
    error: string | null;
    selectedKeyword: string | null;
  },
  [],
  [],
  UnifiedSlice
> = (set, get) => ({
  isUnifiedView: false,
  unifiedRole: null,
  unifiedErrors: new Map(),
  unifiedCounts: [],

  fetchUnifiedEmails: async (accounts, role) => {
    set({
      isLoading: true,
      error: null,
      isUnifiedView: true,
      unifiedRole: role,
      selectedKeyword: null,
    });
    try {
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;
      const result = await fetchUnifiedEmailsLib(accounts, role, emailsPerPage, 0);
      set({
        emails: result.emails,
        hasMoreEmails: result.hasMore,
        totalEmails: result.total,
        isLoading: false,
        unifiedErrors: result.errors,
      });
    } catch (error) {
      console.error('Failed to fetch unified emails:', error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch unified emails",
        isLoading: false,
        emails: [],
        hasMoreEmails: false,
        totalEmails: 0,
      });
    }
  },

  loadMoreUnifiedEmails: async (accounts) => {
    const { isLoadingMore, hasMoreEmails, emails, unifiedRole } = get();
    if (isLoadingMore || !hasMoreEmails || !unifiedRole) return;

    set({ isLoadingMore: true, error: null });
    try {
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;
      const position = emails.length;
      const result = await fetchUnifiedEmailsLib(accounts, unifiedRole, emailsPerPage, position);

      const currentEmails = get().emails;
      const existingIds = new Set(currentEmails.map(e => e.id));
      const newEmails = result.emails.filter(e => !existingIds.has(e.id));

      set({
        emails: [...currentEmails, ...newEmails],
        hasMoreEmails: result.hasMore,
        totalEmails: result.total,
        isLoadingMore: false,
        unifiedErrors: result.errors,
      });
    } catch (error) {
      console.error('Failed to load more unified emails:', error);
      set({
        error: error instanceof Error ? error.message : "Failed to load more unified emails",
        isLoadingMore: false,
      });
    }
  },

  refreshUnifiedCounts: async (accounts) => {
    try {
      const counts = fetchUnifiedMailboxCounts(accounts);
      set({ unifiedCounts: counts });
    } catch (error) {
      console.error('Failed to refresh unified counts:', error);
    }
  },

  exitUnifiedView: () => {
    set({
      isUnifiedView: false,
      unifiedRole: null,
      unifiedErrors: new Map(),
    });
  },
});
