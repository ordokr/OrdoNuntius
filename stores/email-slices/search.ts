/**
 * Search slice of `useEmailStore`. Stage 4 of the slice-split refactor.
 * Owns four state fields:
 *   - `searchFilters`: the structured filter (from/to/before/after/etc.)
 *   - `isAdvancedSearchOpen`: UI toggle for the advanced-search panel
 *   - `searchAbortController`: in-flight search, so a newer search can
 *     cancel an older one (otherwise out-of-order responses would
 *     stomp on the freshest results)
 *   - `externalSearchResults`: plugin-contributed hits (CRM, Slack, etc.)
 *     populated by `emailHooks.onProvideSearchResults`
 *
 * And five actions: `searchEmails` (simple), `advancedSearch` (with
 * filters + cancellation), `setSearchFilters` (partial-merge),
 * `clearSearchFilters` (reset), `toggleAdvancedSearch` (UI).
 *
 * `searchQuery` itself lives in the core slice — it's a primitive used
 * by several non-search code paths (`loadMoreEmails`,
 * `refreshCurrentMailbox`) so pulling it into this slice would invert
 * the dependency direction. The slice reads it but doesn't own it.
 */

import { type StateCreator } from "zustand";
import type { Email, Mailbox } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { SearchFilters, DEFAULT_SEARCH_FILTERS, buildJMAPFilter } from "@/lib/jmap/search-utils";
import { emailHooks } from "@/lib/plugin-hooks";
import type { ExternalSearchResult } from "@/lib/plugin-types";
import { useSettingsStore } from "@/stores/settings-store";

export interface SearchSlice {
  searchFilters: SearchFilters;
  isAdvancedSearchOpen: boolean;
  searchAbortController: AbortController | null;
  externalSearchResults: ExternalSearchResult[];
  searchEmails: (client: IJMAPClient, query: string) => Promise<void>;
  advancedSearch: (client: IJMAPClient) => Promise<void>;
  setSearchFilters: (filters: Partial<SearchFilters>) => void;
  clearSearchFilters: () => void;
  toggleAdvancedSearch: () => void;
}

export const createSearchSlice: StateCreator<
  SearchSlice & {
    searchQuery: string;
    selectedMailbox: string;
    mailboxes: Mailbox[];
    isLoading: boolean;
    emails: Email[];
    hasMoreEmails: boolean;
    totalEmails: number;
    error: string | null;
  },
  [],
  [],
  SearchSlice
> = (set, get) => ({
  searchFilters: { ...DEFAULT_SEARCH_FILTERS },
  isAdvancedSearchOpen: false,
  searchAbortController: null,
  externalSearchResults: [],

  searchEmails: async (client, query) => {
    // Clear the list synchronously so the user sees a fresh loading
    // state instead of stale results during the network RTT.
    set({ isLoading: true, error: null, searchQuery: query, emails: [], hasMoreEmails: false, totalEmails: 0 });
    try {
      const { selectedMailbox, mailboxes, searchFilters } = get();
      const mailbox = mailboxes.find(mb => mb.id === selectedMailbox);
      const jmapMailboxId = mailbox?.originalId || selectedMailbox;
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;

      const result = await client.searchEmails(query, jmapMailboxId, accountId, emailsPerPage, 0);
      const externals = await emailHooks.onProvideSearchResults.transform(
        [] as ExternalSearchResult[],
        { query, filters: searchFilters },
      );

      set({
        emails: result.emails,
        externalSearchResults: externals,
        hasMoreEmails: result.hasMore,
        totalEmails: result.total,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to search emails",
        isLoading: false,
        emails: [],
        externalSearchResults: [],
        hasMoreEmails: false,
        totalEmails: 0,
      });
    }
  },

  advancedSearch: async (client) => {
    const { searchQuery, searchFilters, selectedMailbox, mailboxes, searchAbortController } = get();

    // Cancel any in-flight search. Without this, a slow response from
    // search-N could land after search-(N+1) and stomp on fresh results.
    if (searchAbortController) {
      searchAbortController.abort();
    }

    const controller = new AbortController();
    set({
      isLoading: true,
      error: null,
      emails: [],
      hasMoreEmails: false,
      totalEmails: 0,
      searchAbortController: controller,
    });

    try {
      const mailbox = mailboxes.find(mb => mb.id === selectedMailbox);
      const jmapMailboxId = mailbox?.originalId || selectedMailbox;
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;

      const filter = buildJMAPFilter(searchQuery, searchFilters, jmapMailboxId);
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;
      const result = await client.advancedSearchEmails(filter, accountId, emailsPerPage, 0);

      if (controller.signal.aborted) return;

      const externals = await emailHooks.onProvideSearchResults.transform(
        [] as ExternalSearchResult[],
        { query: searchQuery, filters: searchFilters },
      );

      set({
        emails: result.emails,
        externalSearchResults: externals,
        hasMoreEmails: result.hasMore,
        totalEmails: result.total,
        isLoading: false,
        searchAbortController: null,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      set({
        error: error instanceof Error ? error.message : "Failed to search emails",
        isLoading: false,
        emails: [],
        externalSearchResults: [],
        hasMoreEmails: false,
        totalEmails: 0,
        searchAbortController: null,
      });
    }
  },

  setSearchFilters: (filters) => {
    set(state => ({ searchFilters: { ...state.searchFilters, ...filters } }));
  },

  clearSearchFilters: () => {
    set({ searchFilters: { ...DEFAULT_SEARCH_FILTERS } });
  },

  toggleAdvancedSearch: () => {
    set(state => ({ isAdvancedSearchOpen: !state.isAdvancedSearchOpen }));
  },
});
