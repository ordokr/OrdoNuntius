import { create } from "zustand";
import { Email, Mailbox } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SEARCH_FILTERS, buildJMAPFilter, isFilterEmpty } from "@/lib/jmap/search-utils";
import { emailHooks } from "@/lib/plugin-hooks";
import { fetchUnifiedEmails, type UnifiedAccountClient } from "@/lib/unified-mailbox";
import { useAuthStore } from "@/stores/auth-store";
import { useAccountStore } from "@/stores/account-store";
import { getLastInbox, setLastInbox } from "@/lib/last-inbox";
import { getCachedInbox, setCachedInbox } from "@/lib/cached-inbox-emails";
import { createUnifiedSlice, type UnifiedSlice } from "@/stores/email-slices/unified";
import { createThreadSlice, type ThreadSlice } from "@/stores/email-slices/thread";
import { createSpamSlice, type SpamSlice } from "@/stores/email-slices/spam";
import { createSearchSlice, type SearchSlice } from "@/stores/email-slices/search";
import { createPushSlice, type PushSlice } from "@/stores/email-slices/push";
import { getNextSelectedEmail, getNextSelectedEmailAfterRemoval } from "@/stores/email-slices/_helpers";

interface EmailStore extends UnifiedSlice, ThreadSlice, SpamSlice, SearchSlice, PushSlice {
  emails: Email[];
  mailboxes: Mailbox[];
  selectedEmail: Email | null;
  selectedMailbox: string;
  isLoading: boolean;
  isLoadingEmail: boolean; // Track when a full email is being fetched
  isLoadingMore: boolean; // Track when loading more emails (pagination)
  error: string | null;
  searchQuery: string;
  quota: { used: number; total: number } | null;
  processingReadStatus: Set<string>; // Track emails being marked as read/unread
  selectedEmailIds: Set<string>; // Track selected emails for batch operations
  hasMoreEmails: boolean; // Track if more emails are available to load
  totalEmails: number; // Total number of emails in the current mailbox/query
  // Push-notification state (isPushConnected / lastPushUpdate /
  // newEmailNotification) lives in the `PushSlice` mixed in above
  // (see stores/email-slices/push.ts).

  // Thread expansion state + actions live in the `ThreadSlice` mixed in above
  // (see stores/email-slices/thread.ts).

  // Keyword/tag filter
  selectedKeyword: string | null;
  tagCounts: Record<string, { total: number; unread: number }>;

  // Advanced search state + actions live in the `SearchSlice` mixed in above
  // (see stores/email-slices/search.ts).

  // Unified mailbox state + actions live in the `UnifiedSlice` mixed in above
  // (see stores/email-slices/unified.ts).

  setEmails: (emails: Email[]) => void;
  setMailboxes: (mailboxes: Mailbox[]) => void;
  selectEmail: (email: Email | null) => void;
  selectMailbox: (mailboxId: string) => void;
  setLoading: (loading: boolean) => void;
  setLoadingEmail: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSearchQuery: (query: string) => void;
  setQuota: (quota: { used: number; total: number } | null) => void;
  selectKeyword: (keyword: string | null) => void;
  fetchTagCounts: (client: IJMAPClient) => Promise<void>;
  toggleEmailSelection: (emailId: string) => void;
  selectRangeEmails: (targetEmailId: string) => void;
  lastSelectedEmailId: string | null;
  selectAllEmails: () => void;
  clearSelection: () => void;

  // JMAP operations
  fetchMailboxes: (client: IJMAPClient) => Promise<void>;
  fetchEmails: (client: IJMAPClient, mailboxId?: string) => Promise<void>;
  // Eager post-login bootstrap: fires mailboxes/quota/emails so the round-trips
  // overlap with Next's soft-nav + home-page hydration. Safe to call multiple
  // times; later calls are no-ops while a prior one is in flight.
  prefetchInitialData: (client: IJMAPClient) => Promise<void>;
  loadMoreEmails: (client: IJMAPClient) => Promise<void>;
  fetchEmailContent: (client: IJMAPClient, emailId: string) => Promise<Email | null>;
  fetchQuota: (client: IJMAPClient) => Promise<void>;
  sendEmail: (client: IJMAPClient, to: string[], subject: string, body: string, cc?: string[], bcc?: string[], identityId?: string, fromEmail?: string, draftId?: string, fromName?: string, htmlBody?: string, attachments?: Array<{ blobId: string; name: string; type: string; size: number; disposition?: 'attachment' | 'inline'; cid?: string }>, inReplyTo?: string[], references?: string[], envelopeMailFrom?: string) => Promise<void>;
  sendRawEmail: (client: IJMAPClient, rawMimeBlob: Blob, identityId: string) => Promise<void>;
  deleteEmail: (client: IJMAPClient, emailId: string, forceDelete?: boolean) => Promise<void>;
  markAsRead: (client: IJMAPClient, emailId: string, read: boolean) => Promise<void>;
  moveToMailbox: (client: IJMAPClient, emailId: string, mailboxId: string) => Promise<void>;
  moveEmailsToMailbox: (client: IJMAPClient, emailIds: string[], mailboxId: string) => Promise<void>;
  moveThreadToMailbox: (client: IJMAPClient, emailId: string, mailboxId: string) => Promise<void>;
  // Search actions (searchEmails / advancedSearch / setSearchFilters /
  // clearSearchFilters / toggleAdvancedSearch) are provided by SearchSlice.
  toggleStar: (client: IJMAPClient, emailId: string) => Promise<void>;
  setEmailKeywordsLocal: (emailId: string, keywords: Record<string, boolean>) => void;

  // Batch operations
  batchMarkAsRead: (client: IJMAPClient, read: boolean) => Promise<void>;
  batchDelete: (client: IJMAPClient, permanent?: boolean) => Promise<void>;
  batchMoveToMailbox: (client: IJMAPClient, mailboxId: string) => Promise<void>;
  batchArchive: (client: IJMAPClient) => Promise<void>;

  // Spam operations live in the `SpamSlice` mixed in above (see stores/email-slices/spam.ts).

  // Push notification handlers
  // Push-notification actions (setPushConnected / handleStateChange /
  // refreshCurrentMailbox / handleNewEmailNotification /
  // clearNewEmailNotification) are provided by the PushSlice.

  // Thread expansion actions live in the `ThreadSlice` mixed in above.

  // Mailbox management
  createMailbox: (client: IJMAPClient, name: string, parentId?: string) => Promise<void>;
  renameMailbox: (client: IJMAPClient, mailboxId: string, name: string) => Promise<void>;
  deleteMailbox: (client: IJMAPClient, mailboxId: string) => Promise<void>;
  setMailboxRole: (client: IJMAPClient, mailboxId: string, role: string | null) => Promise<void>;
  emptyMailbox: (client: IJMAPClient, mailboxId: string) => Promise<void>;
  markMailboxAsRead: (client: IJMAPClient, mailboxId: string) => Promise<number>;

  // Unified mailbox operations live in the `UnifiedSlice` mixed in above.

  // Mock data for demo
  loadMockData: () => void;

  /**
   * Reset every store field to its initial value. Used by
   * `account-state-manager.clearAllStores()` when switching accounts.
   * The shape lives here (single source of truth) instead of being
   * duplicated in account-state-manager — that arrangement drifted
   * whenever a new field was added to the store and the manager's
   * reset didn't get updated to match.
   */
  clearState: () => void;
}

// `getNextSelectedEmail` + `getNextSelectedEmailAfterRemoval` live in
// `stores/email-slices/_helpers.ts` so slices can import them without
// pulling in the entire composed store (circular-import risk).

// Find the trash mailbox for a given account scope. Prefers JMAP role, but
// falls back to name matching ("trash" / "deleted") so users with custom or
// pre-existing folders (e.g. "Deleted Items") aren't silently destroyed.
function findTrashMailbox(
  mailboxes: Mailbox[],
  scope: { accountId?: string; isShared?: boolean }
): Mailbox | undefined {
  const matchesScope = (mb: Mailbox): boolean => {
    if (scope.accountId) return mb.accountId === scope.accountId;
    return !mb.isShared;
  };

  const byRole = mailboxes.find(mb => mb.role === 'trash' && matchesScope(mb));
  if (byRole) return byRole;

  return mailboxes.find(mb => {
    if (!matchesScope(mb)) return false;
    const lower = mb.name.toLowerCase();
    return lower.includes('trash') || lower.includes('deleted');
  });
}

export const useEmailStore = create<EmailStore>((set, get, store) => ({
  // Compose the unified-mailbox slice. `EmailStore` extends `UnifiedSlice` so
  // the set/get/store closures are structurally compatible — the slice's
  // StateCreator is typed against a smaller union but reads/writes only fields
  // that also exist on the full store.
  ...createUnifiedSlice(
    set as Parameters<typeof createUnifiedSlice>[0],
    get as Parameters<typeof createUnifiedSlice>[1],
    store as Parameters<typeof createUnifiedSlice>[2],
  ),
  ...createThreadSlice(
    set as Parameters<typeof createThreadSlice>[0],
    get as Parameters<typeof createThreadSlice>[1],
    store as Parameters<typeof createThreadSlice>[2],
  ),
  ...createSpamSlice(
    set as Parameters<typeof createSpamSlice>[0],
    get as Parameters<typeof createSpamSlice>[1],
    store as Parameters<typeof createSpamSlice>[2],
  ),
  ...createSearchSlice(
    set as Parameters<typeof createSearchSlice>[0],
    get as Parameters<typeof createSearchSlice>[1],
    store as Parameters<typeof createSearchSlice>[2],
  ),
  ...createPushSlice(
    set as Parameters<typeof createPushSlice>[0],
    get as Parameters<typeof createPushSlice>[1],
    store as Parameters<typeof createPushSlice>[2],
  ),

  emails: [],
  mailboxes: [],
  selectedEmail: null,
  selectedMailbox: "",
  isLoading: false,
  isLoadingEmail: false,
  isLoadingMore: false,
  error: null,
  searchQuery: "",
  quota: null,
  processingReadStatus: new Set(),
  selectedEmailIds: new Set(),
  lastSelectedEmailId: null,
  hasMoreEmails: false,
  totalEmails: 0,
  // Push state initial values are provided by the PushSlice spread above.

  // Thread expansion state initial values are provided by the ThreadSlice spread above.

  // Keyword/tag filter
  selectedKeyword: null,
  tagCounts: {},

  // Advanced search state initial values are provided by the SearchSlice spread above.
  // Unified mailbox state initial values are provided by the UnifiedSlice spread above.
  // Spam undo cache initial value is provided by the SpamSlice spread above.

  setEmails: (emails) => set({ emails }),
  setMailboxes: (mailboxes) => set({ mailboxes }),
  selectEmail: (email) => {
    const prev = get().selectedEmail;
    set({ selectedEmail: email, lastSelectedEmailId: email?.id ?? get().lastSelectedEmailId });
    if (prev && (!email || email.id !== prev.id)) {
      emailHooks.onEmailClose.emitSync(prev);
    }
    if (email && (!prev || email.id !== prev.id)) {
      emailHooks.onEmailOpen.emitSync(email);
    }
  },
  selectKeyword: (keyword) => set({
    selectedKeyword: keyword,
    selectedEmail: null,
    selectedEmailIds: new Set(),
    expandedThreadIds: new Set(),
    threadEmailsCache: new Map(),
    // Same rationale as selectMailbox: stale undo entries refer to
    // the previous selection's mailbox context.
    spamUndoCache: new Map(),
  }),
  fetchTagCounts: async (client) => {
    try {
      const keywords = useSettingsStore.getState().emailKeywords;
      if (keywords.length === 0) {
        set({ tagCounts: {} });
        return;
      }
      const tagIds = keywords.map(k => k.id);
      const counts = await client.getTagCounts(tagIds);
      set({ tagCounts: counts });
    } catch (error) {
      console.error('Failed to fetch tag counts:', error);
    }
  },
  selectMailbox: (mailboxId) => set({
    selectedMailbox: mailboxId,
    selectedEmail: null,
    selectedEmailIds: new Set(),
    selectedKeyword: null,
    expandedThreadIds: new Set(),
    threadEmailsCache: new Map(),
    isLoadingThread: null,
    // Drop stale undo entries when switching mailboxes — the cached
    // originalMailboxId would refer to the previous mailbox and a
    // late toast-undo would put the email back in the wrong place.
    spamUndoCache: new Map(),
  }),
  setLoading: (loading) => set({ isLoading: loading }),
  setLoadingEmail: (loading) => set({ isLoadingEmail: loading }),
  setError: (error) => set({ error }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setQuota: (quota) => set({ quota }),

  toggleEmailSelection: (emailId) => {
    const { selectedEmailIds } = get();
    const newSelection = new Set(selectedEmailIds);
    if (newSelection.has(emailId)) {
      newSelection.delete(emailId);
    } else {
      newSelection.add(emailId);
    }
    set({ selectedEmailIds: newSelection, lastSelectedEmailId: emailId });
  },

  selectRangeEmails: (targetEmailId) => {
    const { emails, lastSelectedEmailId, selectedEmailIds } = get();
    const anchorId = lastSelectedEmailId || emails[0]?.id;
    if (!anchorId) return;
    const anchorIndex = emails.findIndex(e => e.id === anchorId);
    const targetIndex = emails.findIndex(e => e.id === targetEmailId);
    if (anchorIndex === -1 || targetIndex === -1) return;
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const newSelection = new Set(selectedEmailIds);
    for (let i = start; i <= end; i++) {
      newSelection.add(emails[i].id);
    }
    set({ selectedEmailIds: newSelection });
  },

  selectAllEmails: () => {
    const { emails } = get();
    const allIds = new Set(emails.map(e => e.id));
    set({ selectedEmailIds: allIds });
  },

  clearSelection: () => {
    set({ selectedEmailIds: new Set(), lastSelectedEmailId: null });
  },

  // JMAP operations
  fetchMailboxes: async (client) => {
    // Only toggle the email list's isLoading on the initial load. Background
    // refreshes (after a move/archive that may have created new folders) must
    // not flash the list's loading state, which hides the results-count bar
    // and dims the list while folders re-fetch.
    //
    // Additionally: if emails are already populated (instant-render-from-cache
    // path in prefetchInitialData), skip the loading flash entirely. The user
    // is seeing their inbox; flipping isLoading=true would replace it with a
    // spinner for the few hundred ms until Mailbox/get resolves.
    const isInitialLoad = get().mailboxes.length === 0;
    const hasVisibleEmails = get().emails.length > 0;
    if (isInitialLoad && !hasVisibleEmails) set({ isLoading: true, error: null });
    try {
      const mailboxes = await client.getAllMailboxes();

      // Auto-select inbox if no mailbox is selected or the current selection
      // doesn't exist in the fetched list (e.g. after an account switch)
      const currentSelectedMailbox = get().selectedMailbox;
      const selectionValid = currentSelectedMailbox && mailboxes.some(m => m.id === currentSelectedMailbox);
      const loadingPatch = isInitialLoad ? { isLoading: false } : {};
      if (!selectionValid) {
        // Find inbox in the primary account. Mirror the sidebar's icon
        // logic (`role === "inbox" || name.toLowerCase() === "inbox"`)
        // so the auto-select and the visible folder list agree on which
        // mailbox is the inbox. The name fallback runs regardless of
        // whether `role` is null or some unexpected value, because some
        // JMAP backends (Stalwart included, in certain account setups)
        // omit or non-standardize the role field even when the mailbox
        // is functionally the inbox. Without this, fetchMailboxes would
        // leave selectedMailbox='' and the follow-up fetchEmails would
        // query without a mailbox constraint, returning empty.
        const primary = mailboxes.filter(m => !m.isShared);
        const inboxMailbox =
          primary.find(m => m.role === 'inbox') ||
          primary.find(m => (m.name || '').trim().toLowerCase() === 'inbox');
        if (inboxMailbox) {
          set({ mailboxes, selectedMailbox: inboxMailbox.id, ...loadingPatch });
          // Cache for next cold-load so prefetchInitialData can fire Email/query
          // in parallel with Mailbox/get instead of after it.
          setLastInbox(client.getAccountId(), inboxMailbox.id);
        } else {
          set({ mailboxes, selectedMailbox: '', ...loadingPatch });
        }
      } else {
        set({ mailboxes, ...loadingPatch });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch mailboxes",
        ...(isInitialLoad ? { isLoading: false } : {})
      });
    }
  },

  prefetchInitialData: async (client) => {
    // Coalesce overlapping callers (e.g. login() and a slow home-page useEffect
    // racing for the same fetch). The promise is stashed on the client so we
    // don't need a separate keyed map and stale entries can't outlive the client.
    const target = client as IJMAPClient & { __prefetchPromise?: Promise<void> };
    if (target.__prefetchPromise) return target.__prefetchPromise;
    target.__prefetchPromise = (async () => {
      try {
        // Speculative-parallel cold-load. Previously Mailbox/get had to land
        // before Email/query could fire — one full JMAP roundtrip serialized.
        // We now read the previously-resolved inbox ID from localStorage and
        // fire Email/query in parallel; if Mailbox/get later reports a
        // different inbox ID we discard the speculative result and re-query.
        const accountId = client.getAccountId();
        const speculativeId = getLastInbox(accountId);
        const emailsPerPage = useSettingsStore.getState().emailsPerPage;

        // Gmail-style instant-from-cache render: hydrate the email list
        // from localStorage SYNCHRONOUSLY before any JMAP roundtrip starts.
        // The user sees their last-seen inbox while the network catches
        // up; fresh data swaps in when fetchEmails/the speculative query
        // resolves below. We only hydrate when the store is empty so an
        // already-populated session (e.g. user navigated back) isn't
        // clobbered.
        if (get().emails.length === 0) {
          const cached = getCachedInbox(accountId);
          if (cached && cached.emails.length > 0) {
            set({
              emails: cached.emails as Email[],
              selectedMailbox: cached.mailboxId,
              totalEmails: cached.total,
              hasMoreEmails: cached.hasMore,
              isLoading: false,
            });
            console.info(
              `[prefetch] instant render from cache: ${cached.emails.length}/${cached.total} emails ` +
              `(saved ${Math.round((Date.now() - cached.savedAt) / 1000)}s ago)`,
            );
          }
        }

        const mailboxesPromise = get().fetchMailboxes(client);
        const quotaPromise = get().fetchQuota(client);
        const speculativePromise: Promise<{ emails: Email[]; hasMore: boolean; total: number } | null> =
          speculativeId
            ? client.getEmails(speculativeId, undefined, emailsPerPage, 0, undefined).catch(() => null)
            : Promise.resolve(null);

        await mailboxesPromise;
        const resolvedInboxId = get().selectedMailbox;
        const speculative = await speculativePromise;

        const speculativeMatches =
          speculative !== null && resolvedInboxId !== "" && resolvedInboxId === speculativeId;

        if (speculativeMatches && get().selectedMailbox === speculativeId) {
          // User hasn't navigated away during the race — commit speculative.
          set({
            emails: speculative!.emails,
            hasMoreEmails: speculative!.hasMore,
            totalEmails: speculative!.total,
            isLoading: false,
          });
          console.info(
            `[prefetch] speculative inbox hit: ${speculative!.emails.length}/${speculative!.total} emails (saved 1 RTT)`,
          );
        } else if (resolvedInboxId) {
          await get().fetchEmails(client, resolvedInboxId);
        } else {
          await get().fetchEmails(client);
        }

        await quotaPromise.catch(() => undefined);
        // Tag counts are background-priority — they only populate the
        // sidebar tag-filter badge numbers. Defer to an idle window so the
        // browser can finish first-paint / hydration before paying the
        // (multi-keyword fan-out) cost. requestIdleCallback isn't in every
        // browser yet, so fall back to a generous setTimeout.
        const fireTagCounts = () => { void get().fetchTagCounts(client); };
        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
          (window as typeof window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
            .requestIdleCallback(fireTagCounts, { timeout: 2000 });
        } else {
          setTimeout(fireTagCounts, 500);
        }
      } finally {
        delete target.__prefetchPromise;
      }
    })();
    return target.__prefetchPromise;
  },

  fetchEmails: async (client, mailboxId) => {
    set({ isLoading: true, error: null }); // Keep previous emails visible during transition
    try {
      const targetMailboxId = mailboxId || get().selectedMailbox;

      // Find the mailbox to get its accountId (for shared folder support)
      const mailboxes = get().mailboxes;
      const mailbox = mailboxes.find(mb => mb.id === targetMailboxId);
      // Only pass accountId for shared mailboxes, not for primary account
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;
      // Use originalId for JMAP queries (shared mailboxes use namespaced IDs in the store)
      const jmapMailboxId = mailbox?.originalId || targetMailboxId;

      // Get emails per page from settings
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;

      // Build keyword filter if a tag is selected
      const { selectedKeyword } = get();
      const keywordFilter = selectedKeyword ? `$label:${selectedKeyword}` : undefined;

      // When filtering by tag, omit the mailbox constraint so emails across
      // all folders that carry the tag are returned.
      const t0 = performance.now();
      const result = await client.getEmails(selectedKeyword ? undefined : jmapMailboxId, accountId, emailsPerPage, 0, keywordFilter);
      // Prod-visible breadcrumb. Triggered for every fetchEmails. If a
      // user reports "inbox empty after login", the most recent line of
      // this log tells us: which mailbox was queried, with what filter,
      // and what came back. Cheap (one console line per ~3-sec user
      // action) and easier than reading the JMAP wire log.
      console.info(
        `[fetchEmails] mailbox="${mailbox?.name ?? '<not-in-store>'}" id=${jmapMailboxId} ` +
        `keyword=${selectedKeyword ?? '<none>'} acct=${accountId ?? '<primary>'} ` +
        `-> ${result.emails.length}/${result.total} emails in ${Math.round(performance.now() - t0)}ms`,
      );
      set({
        emails: result.emails,
        hasMoreEmails: result.hasMore,
        totalEmails: result.total,
        isLoading: false
      });
      // Persist the freshly-fetched page for the next cold-load's instant
      // render. Skip shared mailboxes and keyword-filtered views — those
      // have different identity semantics and would corrupt the cache when
      // restored against an unfiltered inbox view.
      if (mailbox && !mailbox.isShared && !selectedKeyword && jmapMailboxId) {
        setCachedInbox(
          client.getAccountId(),
          jmapMailboxId,
          result.emails,
          result.total,
          result.hasMore,
        );
      }
    } catch (error) {
      console.error('Failed to fetch emails:', error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch emails",
        isLoading: false,
        emails: [],
        hasMoreEmails: false,
        totalEmails: 0
      });
    }
  },

  loadMoreEmails: async (client) => {
    const { isLoadingMore, hasMoreEmails, emails, selectedMailbox, searchQuery, selectedKeyword, isUnifiedView, unifiedRole } = get();

    // Don't load if already loading or no more emails
    if (isLoadingMore || !hasMoreEmails) return;

    // Unified view uses a different fan-out loader. Rebuild the per-account
    // client list from auth/account stores and delegate.
    if (isUnifiedView && unifiedRole) {
      set({ isLoadingMore: true, error: null });
      try {
        const emailsPerPage = useSettingsStore.getState().emailsPerPage;
        const position = emails.length;
        const authAccounts = useAccountStore.getState().accounts.filter(a => a.isConnected);
        const allClients = useAuthStore.getState().getAllConnectedClients();
        const built: UnifiedAccountClient[] = [];
        for (const a of authAccounts) {
          const c = allClients.get(a.id);
          if (!c) continue;
          try {
            const mailboxes = await c.getMailboxes();
            built.push({ accountId: a.id, accountLabel: a.label || a.email, client: c, mailboxes });
          } catch {
            /* skip account on mailbox fetch failure */
          }
        }
        const result = await fetchUnifiedEmails(built, unifiedRole, emailsPerPage, position);
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
          error: error instanceof Error ? error.message : "Failed to load more emails",
          isLoadingMore: false,
        });
      }
      return;
    }

    set({ isLoadingMore: true, error: null });
    try {
      // Get emails per page from settings
      const emailsPerPage = useSettingsStore.getState().emailsPerPage;

      // Capture position from current email count before the async call
      const position = emails.length;

      let result;

      const { searchFilters } = get();
      const hasFilters = !isFilterEmpty(searchFilters);

      if (searchQuery || hasFilters) {
        const mailboxes = get().mailboxes;
        const mailbox = mailboxes.find(mb => mb.id === selectedMailbox);
        const jmapMailboxId = mailbox?.originalId || selectedMailbox;
        const accountId = mailbox?.isShared ? mailbox.accountId : undefined;

        if (hasFilters) {
          const filter = buildJMAPFilter(searchQuery, searchFilters, jmapMailboxId);
          result = await client.advancedSearchEmails(filter, accountId, emailsPerPage, position);
        } else {
          result = await client.searchEmails(searchQuery, jmapMailboxId, accountId, emailsPerPage, position);
        }
      } else {
        // Load more from mailbox
        // Find the mailbox to get its accountId (for shared folder support)
        const mailboxes = get().mailboxes;
        const mailbox = mailboxes.find(mb => mb.id === selectedMailbox);
        // Only pass accountId for shared mailboxes, not for primary account
        const accountId = mailbox?.isShared ? mailbox.accountId : undefined;
        // Use originalId for JMAP queries (shared mailboxes use namespaced IDs in the store)
        const jmapMailboxId = mailbox?.originalId || selectedMailbox;

        // When filtering by tag, omit the mailbox constraint (same rationale as fetchEmails).
        result = await client.getEmails(selectedKeyword ? undefined : jmapMailboxId, accountId, emailsPerPage, position, selectedKeyword ? `$label:${selectedKeyword}` : undefined);
      }

      // Use fresh state when merging to avoid overwriting concurrent updates
      // (e.g. refreshCurrentMailbox running during the load)
      const currentEmails = get().emails;

      // Deduplicate: the server may return overlapping results if new emails
      // arrived between paginated requests and shifted positions.
      const existingIds = new Set(currentEmails.map(e => e.id));
      const newEmails = result.emails.filter((e: Email) => !existingIds.has(e.id));

      set({
        emails: [...currentEmails, ...newEmails],
        hasMoreEmails: result.hasMore,
        totalEmails: result.total,
        isLoadingMore: false
      });
    } catch (error) {
      console.error('Failed to load more emails:', error);
      set({
        error: error instanceof Error ? error.message : "Failed to load more emails",
        isLoadingMore: false
      });
    }
  },

  fetchEmailContent: async (client, emailId) => {
    try {
      // Find the selected mailbox to determine accountId (for shared folders)
      const selectedMailboxId = get().selectedMailbox;
      const mailboxes = get().mailboxes;
      const mailbox = mailboxes.find(mb => mb.id === selectedMailboxId);

      // Only pass accountId for shared mailboxes
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;

      const email = await client.getEmail(emailId, accountId);

      if (email) {
        set({ selectedEmail: email });
      }
      return email;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to fetch email content"
      });
      return null;
    }
  },

  fetchQuota: async (client) => {
    try {
      const quota = await client.getQuota();
      set({ quota });
    } catch {
      // Don't set error state as quota is optional
    }
  },

  sendEmail: async (client, to, subject, body, cc, bcc, identityId, fromEmail, draftId, fromName, htmlBody, attachments, inReplyTo, references, envelopeMailFrom) => {
    set({ isLoading: true, error: null });
    try {
      await client.sendEmail(to, subject, body, cc, bcc, identityId, fromEmail, draftId, fromName, htmlBody, attachments, inReplyTo, references, envelopeMailFrom);
      // Refresh handled by UI layer for immediate feedback
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to send email",
        isLoading: false
      });
      throw error;
    }
  },

  sendRawEmail: async (client, rawMimeBlob, identityId) => {
    set({ isLoading: true, error: null });
    try {
      const mailboxes = await client.getMailboxes();
      const sentMailbox = mailboxes.find(mb => mb.role === 'sent');
      if (!sentMailbox) throw new Error('No sent mailbox found');
      const draftsMailbox = mailboxes.find(mb => mb.role === 'drafts');
      await client.sendRawEmail(rawMimeBlob, identityId, sentMailbox.id, draftsMailbox?.id);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to send email",
        isLoading: false,
      });
      throw error;
    }
  },

  deleteEmail: async (client, emailId, forceDelete) => {
    try {
      // Get the email to check if it's unread and which mailboxes it belongs to
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      const isUnread = !email.keywords?.$seen;

      // Get delete action preference from settings
      const deleteAction = useSettingsStore.getState().deleteAction;
      const permanentlyDeleteJunk = useSettingsStore.getState().permanentlyDeleteJunk;

      // Determine accountId for shared folders
      const selectedMailboxId = get().selectedMailbox;
      const mailboxes = get().mailboxes;
      const currentMailbox = mailboxes.find(mb => mb.id === selectedMailboxId);
      const accountId = currentMailbox?.isShared ? currentMailbox.accountId : undefined;

      // If in junk folder and setting is enabled, permanently delete
      const isInJunk = currentMailbox?.role === 'junk';
      if (isInJunk && permanentlyDeleteJunk) {
        forceDelete = true;
      }

      // If deleteAction is 'trash' and not forced permanent delete, try to move to trash mailbox
      if (deleteAction === 'trash' && !forceDelete) {
        const trashMailbox = findTrashMailbox(mailboxes, { accountId });

        if (trashMailbox) {
          // Use originalId for shared mailboxes if available
          const trashId = trashMailbox.originalId || trashMailbox.id;
          await client.moveToTrash(emailId, trashId, accountId);

          // Remove from local state (email moved to trash, not in current view)
          set((state) => {
            let updatedMailboxes = state.mailboxes;

            // Update counters for source mailbox (email leaving)
            if (email.mailboxIds) {
              updatedMailboxes = state.mailboxes.map(mailbox => {
                if (email.mailboxIds[mailbox.id]) {
                  return {
                    ...mailbox,
                    totalEmails: Math.max(0, mailbox.totalEmails - 1),
                    unreadEmails: isUnread ? Math.max(0, mailbox.unreadEmails - 1) : mailbox.unreadEmails,
                    totalThreads: Math.max(0, mailbox.totalThreads - 1),
                    unreadThreads: isUnread ? Math.max(0, mailbox.unreadThreads - 1) : mailbox.unreadThreads
                  };
                }
                // Update trash mailbox counters (email arriving)
                if (mailbox.id === trashMailbox.id) {
                  return {
                    ...mailbox,
                    totalEmails: mailbox.totalEmails + 1,
                    unreadEmails: isUnread ? mailbox.unreadEmails + 1 : mailbox.unreadEmails,
                    totalThreads: mailbox.totalThreads + 1,
                    unreadThreads: isUnread ? mailbox.unreadThreads + 1 : mailbox.unreadThreads
                  };
                }
                return mailbox;
              });
            }

            return {
              emails: state.emails.filter(e => e.id !== emailId),
              selectedEmail: getNextSelectedEmail(state, emailId),
              mailboxes: updatedMailboxes
            };
          });
          return;
        }
        // No trash folder found in this account. Surface the failure rather
        // than silently destroying the email - the user asked to move it to
        // trash, not to permanently delete it.
        throw new Error('Trash mailbox not found - cannot move email to trash');
      }

      // Permanent delete
      await client.deleteEmail(emailId);

      // Remove from local state and update mailbox counters if needed
      set((state) => {
        let updatedMailboxes = state.mailboxes;

        // If the email was unread, decrement the unread counters
        if (isUnread && email.mailboxIds) {
          updatedMailboxes = state.mailboxes.map(mailbox => {
            if (email.mailboxIds[mailbox.id]) {
              return {
                ...mailbox,
                totalEmails: Math.max(0, mailbox.totalEmails - 1),
                unreadEmails: Math.max(0, mailbox.unreadEmails - 1),
                totalThreads: Math.max(0, mailbox.totalThreads - 1),
                unreadThreads: Math.max(0, mailbox.unreadThreads - 1)
              };
            }
            return mailbox;
          });
        } else if (email.mailboxIds) {
          // If email was read, only decrement total counters
          updatedMailboxes = state.mailboxes.map(mailbox => {
            if (email.mailboxIds[mailbox.id]) {
              return {
                ...mailbox,
                totalEmails: Math.max(0, mailbox.totalEmails - 1),
                totalThreads: Math.max(0, mailbox.totalThreads - 1)
              };
            }
            return mailbox;
          });
        }

        return {
          emails: state.emails.filter(e => e.id !== emailId),
          selectedEmail: getNextSelectedEmail(state, emailId),
          mailboxes: updatedMailboxes
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete email"
      });
      throw error;
    }
  },

  markAsRead: async (client, emailId, read) => {
    // Coalesce concurrent calls for the same (id, target-state) pair.
    const processingKey = `${emailId}-${read}`;
    if (get().processingReadStatus.has(processingKey)) {
      return;
    }

    const email = get().emails.find(e => e.id === emailId);
    if (!email) return;

    // No-op if already in desired state.
    const isCurrentlyRead = email.keywords?.$seen === true;
    if (isCurrentlyRead === read) {
      return;
    }

    // OPTIMISTIC UPDATE: flip local state + counters first so the UI
    // responds in ~0ms (used to await JMAP RTT before any visible
    // change). Snapshot prior emails / selectedEmail / mailboxes so
    // we can roll back on server failure. Applies the RTT-min rule.
    const prevState = get();
    const prevEmail = prevState.emails.find(e => e.id === emailId);
    const prevSelectedEmail = prevState.selectedEmail;
    const prevMailboxes = prevState.mailboxes;

    set((state) => {
      const updatedMailboxes = state.mailboxes.map(mailbox => {
        if (email.mailboxIds && email.mailboxIds[mailbox.id]) {
          const delta = read ? -1 : 1;
          return {
            ...mailbox,
            unreadEmails: Math.max(0, mailbox.unreadEmails + delta),
            unreadThreads: Math.max(0, mailbox.unreadThreads + delta),
          };
        }
        return mailbox;
      });
      return {
        emails: state.emails.map(e =>
          e.id === emailId ? { ...e, keywords: { ...e.keywords, $seen: read } } : e
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, keywords: { ...state.selectedEmail.keywords, $seen: read } }
          : state.selectedEmail,
        mailboxes: updatedMailboxes,
        processingReadStatus: new Set([...state.processingReadStatus, processingKey]),
      };
    });

    try {
      const selectedMailboxId = get().selectedMailbox;
      const currentMailbox = get().mailboxes.find(mb => mb.id === selectedMailboxId);
      const accountId = currentMailbox?.isShared ? currentMailbox.accountId : undefined;

      await client.markAsRead(emailId, read, accountId);

      // Success — just clear the processing key. Local state is
      // already correct from the optimistic flip above.
      set((state) => {
        const next = new Set(state.processingReadStatus);
        next.delete(processingKey);
        return { processingReadStatus: next };
      });
    } catch (error) {
      // Roll back optimistic update. Restore the specific email's
      // prior keywords + selectedEmail + mailbox counters. Don't
      // blanket-replace `emails` array because other in-flight ops
      // may have changed unrelated rows during our await.
      set((state) => {
        const next = new Set(state.processingReadStatus);
        next.delete(processingKey);
        return {
          processingReadStatus: next,
          emails: state.emails.map(e =>
            e.id === emailId && prevEmail
              ? { ...e, keywords: prevEmail.keywords }
              : e
          ),
          selectedEmail: state.selectedEmail?.id === emailId && prevSelectedEmail
            ? { ...state.selectedEmail, keywords: prevSelectedEmail.keywords }
            : state.selectedEmail,
          // Counters: revert just the touched mailboxes. Other
          // mailboxes may have had unrelated mutations meanwhile, so
          // pull from `state.mailboxes` not the snapshot.
          mailboxes: state.mailboxes.map(mailbox => {
            const prevMb = prevMailboxes.find(pm => pm.id === mailbox.id);
            if (!prevMb) return mailbox;
            if (!email.mailboxIds || !email.mailboxIds[mailbox.id]) return mailbox;
            const delta = read ? 1 : -1; // reverse of optimistic delta
            return {
              ...mailbox,
              unreadEmails: Math.max(0, mailbox.unreadEmails + delta),
              unreadThreads: Math.max(0, mailbox.unreadThreads + delta),
            };
          }),
          error: error instanceof Error ? error.message : "Failed to update email",
        };
      });
      throw error;
    }
  },

  moveToMailbox: async (client, emailId, destinationMailboxId) => {
    try {
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      const isUnread = !email.keywords?.$seen;
      const currentMailboxIds = email.mailboxIds ? Object.keys(email.mailboxIds) : [];

      const { selectedMailbox, mailboxes } = get();
      const currentMailbox = mailboxes.find(mb => mb.id === selectedMailbox);
      const accountId = currentMailbox?.isShared ? currentMailbox.accountId : undefined;

      const destMailbox = mailboxes.find(mb => mb.id === destinationMailboxId);
      const jmapDestId = destMailbox?.originalId || destinationMailboxId;

      await client.moveEmail(emailId, jmapDestId, accountId);

      set((state) => {
        const updatedMailboxes = state.mailboxes.map(mailbox => {
          if (currentMailboxIds.includes(mailbox.id)) {
            return {
              ...mailbox,
              totalEmails: Math.max(0, mailbox.totalEmails - 1),
              unreadEmails: isUnread ? Math.max(0, mailbox.unreadEmails - 1) : mailbox.unreadEmails,
              totalThreads: Math.max(0, mailbox.totalThreads - 1),
              unreadThreads: isUnread ? Math.max(0, mailbox.unreadThreads - 1) : mailbox.unreadThreads
            };
          }
          if (mailbox.id === destinationMailboxId) {
            return {
              ...mailbox,
              totalEmails: mailbox.totalEmails + 1,
              unreadEmails: isUnread ? mailbox.unreadEmails + 1 : mailbox.unreadEmails,
              totalThreads: mailbox.totalThreads + 1,
              unreadThreads: isUnread ? mailbox.unreadThreads + 1 : mailbox.unreadThreads
            };
          }
          return mailbox;
        });

        return {
          emails: state.emails.filter(e => e.id !== emailId),
          selectedEmail: getNextSelectedEmail(state, emailId),
          mailboxes: updatedMailboxes
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to move email"
      });
      throw error;
    }
  },

  moveEmailsToMailbox: async (client, emailIds, destinationMailboxId) => {
    if (emailIds.length === 0) return;
    if (emailIds.length === 1) {
      await get().moveToMailbox(client, emailIds[0], destinationMailboxId);
      return;
    }

    try {
      const { emails, mailboxes, selectedMailbox, isUnifiedView } = get();
      const destMailbox = mailboxes.find(mb => mb.id === destinationMailboxId);
      const jmapDestId = destMailbox?.originalId || destinationMailboxId;
      const idSet = new Set(emailIds);
      const affected = emails.filter(e => idSet.has(e.id));

      if (isUnifiedView) {
        // In unified view, emails may span accounts – group and dispatch per-account.
        const byAccount = new Map<string, string[]>();
        for (const e of affected) {
          const acct = e.accountId || '__default__';
          if (!byAccount.has(acct)) byAccount.set(acct, []);
          byAccount.get(acct)!.push(e.id);
        }
        await Promise.all(Array.from(byAccount.entries()).map(async ([acct, ids]) => {
          const acctClient = acct === '__default__' ? client : useAuthStore.getState().getClientForAccount(acct);
          if (!acctClient) return;
          await acctClient.batchMoveEmails(ids, jmapDestId);
        }));
      } else {
        const currentMailbox = mailboxes.find(mb => mb.id === selectedMailbox);
        const accountId = currentMailbox?.isShared ? currentMailbox.accountId : undefined;
        await client.batchMoveEmails(emailIds, jmapDestId, accountId);
      }

      // Adjust counters and drop moved emails from the current view.
      let unreadDelta = 0;
      const sourceMailboxIds = new Set<string>();
      for (const e of affected) {
        if (!e.keywords?.$seen) unreadDelta += 1;
        if (e.mailboxIds) for (const mid of Object.keys(e.mailboxIds)) sourceMailboxIds.add(mid);
      }
      const movedCount = affected.length;

      set((state) => ({
        emails: state.emails.filter(e => !idSet.has(e.id)),
        selectedEmail: state.selectedEmail && idSet.has(state.selectedEmail.id) ? null : state.selectedEmail,
        selectedEmailIds: (() => {
          const next = new Set(state.selectedEmailIds);
          for (const id of idSet) next.delete(id);
          return next;
        })(),
        mailboxes: state.mailboxes.map(mb => {
          if (sourceMailboxIds.has(mb.id)) {
            return {
              ...mb,
              totalEmails: Math.max(0, mb.totalEmails - movedCount),
              unreadEmails: Math.max(0, mb.unreadEmails - unreadDelta),
            };
          }
          if (mb.id === destinationMailboxId) {
            return {
              ...mb,
              totalEmails: mb.totalEmails + movedCount,
              unreadEmails: mb.unreadEmails + unreadDelta,
            };
          }
          return mb;
        }),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to move emails' });
      throw error;
    }
  },

  moveThreadToMailbox: async (client, emailId, destinationMailboxId) => {
    try {
      const state = get();
      const email = state.emails.find(e => e.id === emailId)
        ?? (state.selectedEmail?.id === emailId ? state.selectedEmail : null);

      if (!email?.threadId) {
        await get().moveToMailbox(client, emailId, destinationMailboxId);
        return;
      }

      const currentMailbox = state.mailboxes.find(mb => mb.id === state.selectedMailbox);
      const accountId = currentMailbox?.isShared ? currentMailbox.accountId : undefined;
      const destMailbox = state.mailboxes.find(mb => mb.id === destinationMailboxId);
      const jmapDestId = destMailbox?.originalId || destinationMailboxId;

      const thread = await client.getThread(email.threadId, accountId);
      const threadEmailIds = thread?.emailIds?.length ? thread.emailIds : [emailId];

      if (threadEmailIds.length <= 1) {
        await get().moveToMailbox(client, emailId, destinationMailboxId);
        return;
      }

      await client.batchMoveEmails(threadEmailIds, jmapDestId, accountId);

      const removedEmailIds = new Set(threadEmailIds);
      set((currentState) => {
        const nextSelectedEmail = getNextSelectedEmailAfterRemoval(currentState, removedEmailIds);
        const nextSelectedEmailIds = new Set(
          Array.from(currentState.selectedEmailIds).filter(id => !removedEmailIds.has(id))
        );
        const nextExpandedThreadIds = new Set(currentState.expandedThreadIds);
        nextExpandedThreadIds.delete(email.threadId);
        const nextThreadEmailsCache = new Map(currentState.threadEmailsCache);
        nextThreadEmailsCache.delete(email.threadId);

        return {
          emails: currentState.emails.filter(currentEmail => !removedEmailIds.has(currentEmail.id)),
          selectedEmail: nextSelectedEmail,
          selectedEmailIds: nextSelectedEmailIds,
          expandedThreadIds: nextExpandedThreadIds,
          threadEmailsCache: nextThreadEmailsCache,
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to move email thread"
      });
      throw error;
    }
  },

  // Search actions are provided by the SearchSlice spread above.

  toggleStar: async (client, emailId) => {
    try {
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      const isFlagged = email.keywords.$flagged || false;
      await client.toggleStar(emailId, !isFlagged);

      // Update local state
      set((state) => ({
        emails: state.emails.map(e =>
          e.id === emailId ? { ...e, keywords: { ...e.keywords, $flagged: !isFlagged } } : e
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, keywords: { ...state.selectedEmail.keywords, $flagged: !isFlagged } }
          : state.selectedEmail
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update star"
      });
      throw error;
    }
  },

  setEmailKeywordsLocal: (emailId, keywords) => {
    set((state) => ({
      emails: state.emails.map(e =>
        e.id === emailId ? { ...e, keywords: { ...keywords } } : e
      ),
      selectedEmail: state.selectedEmail?.id === emailId
        ? { ...state.selectedEmail, keywords: { ...keywords } }
        : state.selectedEmail,
    }));
  },

  // Batch operations
  batchMarkAsRead: async (client, read) => {
    const { selectedEmailIds, emails, mailboxes } = get();
    if (selectedEmailIds.size === 0) return;

    set({ isLoading: true, error: null });
    try {
      const emailIdsArray = Array.from(selectedEmailIds);

      // Bulk operations on large mailboxes were O(selected × emails) because
      // each loop did emails.find(e.id === emailId). One Map build is
      // O(emails); each lookup becomes O(1).
      const emailsById = new Map(emails.map(e => [e.id, e]));

      if (get().isUnifiedView) {
        // Group emails by accountId for cross-account operations
        const emailsByAccount = new Map<string, string[]>();
        for (const emailId of emailIdsArray) {
          const email = emailsById.get(emailId);
          const acctId = email?.accountId || '__default__';
          if (!emailsByAccount.has(acctId)) emailsByAccount.set(acctId, []);
          emailsByAccount.get(acctId)!.push(emailId);
        }

        const promises = Array.from(emailsByAccount.entries()).map(async ([acctId, ids]) => {
          const acctClient = acctId === '__default__' ? client : useAuthStore.getState().getClientForAccount(acctId);
          if (!acctClient) return;
          await acctClient.batchMarkAsRead(ids, read);
        });
        await Promise.allSettled(promises);
      } else {
        await client.batchMarkAsRead(emailIdsArray, read);
      }

      // Update local state
      const updatedEmails = emails.map(email =>
        selectedEmailIds.has(email.id)
          ? { ...email, keywords: { ...email.keywords, $seen: read } }
          : email
      );

      // Update mailbox counters. Was O(M × A) — for each mailbox we walked
      // every affected email to test mailbox.id membership. Inverted: walk
      // each affected email once, accumulate per-mailbox deltas keyed by
      // mailbox id (most emails live in 1-2 mailboxes, so avg-case is
      // O(A × ~2 + M) instead of O(M × A)).
      const unreadDelta = new Map<string, number>();
      for (const emailId of emailIdsArray) {
        const email = emailsById.get(emailId);
        if (!email?.mailboxIds) continue;
        const wasRead = email.keywords?.$seen === true;
        if (wasRead === read) continue;
        const sign = read ? -1 : 1;
        for (const mailboxId of Object.keys(email.mailboxIds)) {
          unreadDelta.set(mailboxId, (unreadDelta.get(mailboxId) ?? 0) + sign);
        }
      }
      const updatedMailboxes = mailboxes.map(mailbox => {
        const deltaUnread = unreadDelta.get(mailbox.id) ?? 0;
        if (deltaUnread === 0) return mailbox;
        return {
          ...mailbox,
          unreadEmails: Math.max(0, mailbox.unreadEmails + deltaUnread),
          unreadThreads: Math.max(0, mailbox.unreadThreads + deltaUnread)
        };
      });

      set({
        emails: updatedEmails,
        mailboxes: updatedMailboxes,
        selectedEmailIds: new Set(),
        isLoading: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update emails",
        isLoading: false
      });
    }
  },

  batchDelete: async (client, permanent = false) => {
    const { selectedEmailIds, emails, mailboxes, selectedMailbox } = get();
    if (selectedEmailIds.size === 0) return;

    set({ isLoading: true, error: null });
    try {
      const emailIdsArray = Array.from(selectedEmailIds);

      // Determine if the current folder forces permanent deletion.
      const currentMailbox = mailboxes.find(m => m.id === selectedMailbox);
      const isInTrash = currentMailbox?.role === 'trash';
      const permanentlyDeleteJunk = useSettingsStore.getState().permanentlyDeleteJunk;
      const isInJunk = currentMailbox?.role === 'junk';
      const forceDestroy = permanent || isInTrash || (isInJunk && permanentlyDeleteJunk);

      // Build emailsById once; loops below were each O(selected × emails).
      const emailsById = new Map(emails.map(e => [e.id, e]));

      // Group emails by accountId (handles unified view and search results spanning accounts).
      const emailsByAccount = new Map<string, string[]>();
      for (const emailId of emailIdsArray) {
        const email = emailsById.get(emailId);
        const acctId = email?.accountId || '__default__';
        if (!emailsByAccount.has(acctId)) emailsByAccount.set(acctId, []);
        emailsByAccount.get(acctId)!.push(emailId);
      }

      const getClient = (acctId: string) =>
        acctId === '__default__' ? client : useAuthStore.getState().getClientForAccount(acctId);

      if (forceDestroy) {
        const promises = Array.from(emailsByAccount.entries()).map(async ([acctId, ids]) => {
          const acctClient = getClient(acctId);
          if (!acctClient) return;
          await acctClient.batchDeleteEmails(ids);
        });
        await Promise.allSettled(promises);
      } else {
        // Move to trash per account.
        const failedAccounts: string[] = [];
        const movedEmailIds = new Set<string>();
        const promises = Array.from(emailsByAccount.entries()).map(async ([acctId, ids]) => {
          const acctClient = getClient(acctId);
          if (!acctClient) {
            failedAccounts.push(acctId);
            return;
          }
          const trashMailbox = findTrashMailbox(mailboxes, {
            accountId: acctId === '__default__' ? undefined : acctId,
          });
          if (!trashMailbox) {
            // No trash for this account: skip rather than silently destroying.
            // The user asked to move to trash, not permanently delete.
            failedAccounts.push(acctId);
            return;
          }
          const trashId = trashMailbox.originalId || trashMailbox.id;
          await acctClient.batchMoveEmails(ids, trashId, trashMailbox.accountId);
          ids.forEach(id => movedEmailIds.add(id));
        });
        await Promise.allSettled(promises);

        if (failedAccounts.length > 0 && movedEmailIds.size === 0) {
          // Nothing moved - bail out so the UI doesn't drop the emails from view.
          throw new Error('Trash mailbox not found - cannot move emails to trash');
        }

        // Only remove successfully moved emails from local state.
        if (movedEmailIds.size < emailIdsArray.length) {
          // Single pass per email instead of mailboxes.map × emails.forEach
          // (O(D + M) vs O(D × M)). Most emails are in 1-2 mailboxes.
          const totalDelta = new Map<string, number>();
          const unreadDelta = new Map<string, number>();
          const remainingEmails: Email[] = [];
          for (const email of emails) {
            if (movedEmailIds.has(email.id)) {
              if (!email.mailboxIds) continue;
              const isUnread = !email.keywords?.$seen;
              for (const mailboxId of Object.keys(email.mailboxIds)) {
                totalDelta.set(mailboxId, (totalDelta.get(mailboxId) ?? 0) - 1);
                if (isUnread) {
                  unreadDelta.set(mailboxId, (unreadDelta.get(mailboxId) ?? 0) - 1);
                }
              }
            } else {
              remainingEmails.push(email);
            }
          }
          const updatedMailboxes = mailboxes.map(mailbox => {
            const dt = totalDelta.get(mailbox.id) ?? 0;
            const du = unreadDelta.get(mailbox.id) ?? 0;
            if (dt === 0 && du === 0) return mailbox;
            return {
              ...mailbox,
              totalEmails: Math.max(0, mailbox.totalEmails + dt),
              unreadEmails: Math.max(0, mailbox.unreadEmails + du),
              totalThreads: Math.max(0, mailbox.totalThreads + dt),
              unreadThreads: Math.max(0, mailbox.unreadThreads + du),
            };
          });
          set({
            emails: remainingEmails,
            mailboxes: updatedMailboxes,
            selectedEmailIds: new Set(),
            selectedEmail: null,
            isLoading: false,
            error: 'Some emails could not be moved: trash folder missing for one or more accounts',
          });
          return;
        }
      }

      // Remove deleted emails and accumulate mailbox deltas in a single
      // pass — was O(emails) × 2 (filter both ways) + O(M × D) for counters.
      const totalDelta = new Map<string, number>();
      const unreadDelta = new Map<string, number>();
      const remainingEmails: Email[] = [];
      for (const email of emails) {
        if (selectedEmailIds.has(email.id)) {
          if (!email.mailboxIds) continue;
          const isUnread = !email.keywords?.$seen;
          for (const mailboxId of Object.keys(email.mailboxIds)) {
            totalDelta.set(mailboxId, (totalDelta.get(mailboxId) ?? 0) - 1);
            if (isUnread) {
              unreadDelta.set(mailboxId, (unreadDelta.get(mailboxId) ?? 0) - 1);
            }
          }
        } else {
          remainingEmails.push(email);
        }
      }
      const updatedMailboxes = mailboxes.map(mailbox => {
        const dt = totalDelta.get(mailbox.id) ?? 0;
        const du = unreadDelta.get(mailbox.id) ?? 0;
        if (dt === 0 && du === 0) return mailbox;
        return {
          ...mailbox,
          totalEmails: Math.max(0, mailbox.totalEmails + dt),
          unreadEmails: Math.max(0, mailbox.unreadEmails + du),
          totalThreads: Math.max(0, mailbox.totalThreads + dt),
          unreadThreads: Math.max(0, mailbox.unreadThreads + du)
        };
      });

      set({
        emails: remainingEmails,
        mailboxes: updatedMailboxes,
        selectedEmailIds: new Set(),
        selectedEmail: null,
        isLoading: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete emails",
        isLoading: false
      });
    }
  },

  batchMoveToMailbox: async (client, toMailboxId) => {
    const { selectedEmailIds, emails } = get();
    if (selectedEmailIds.size === 0) return;

    set({ isLoading: true, error: null });
    try {
      const emailIdsArray = Array.from(selectedEmailIds);

      if (get().isUnifiedView) {
        // Build emailsById once; the loop below was O(selected × emails).
        const emailsById = new Map(emails.map(e => [e.id, e]));
        // Group emails by accountId for cross-account operations
        const emailsByAccount = new Map<string, string[]>();
        for (const emailId of emailIdsArray) {
          const email = emailsById.get(emailId);
          const acctId = email?.accountId || '__default__';
          if (!emailsByAccount.has(acctId)) emailsByAccount.set(acctId, []);
          emailsByAccount.get(acctId)!.push(emailId);
        }

        const promises = Array.from(emailsByAccount.entries()).map(async ([acctId, ids]) => {
          const acctClient = acctId === '__default__' ? client : useAuthStore.getState().getClientForAccount(acctId);
          if (!acctClient) return;
          await acctClient.batchMoveEmails(ids, toMailboxId);
        });
        await Promise.allSettled(promises);
      } else {
        await client.batchMoveEmails(emailIdsArray, toMailboxId);
      }

      // Update local state - remove from current view since they moved
      const remainingEmails = emails.filter(e => !selectedEmailIds.has(e.id));

      set({
        emails: remainingEmails,
        selectedEmailIds: new Set(),
        isLoading: false
      });

      // Refresh emails to get updated list (honors active search/filters)
      if (!get().isUnifiedView) {
        await get().refreshCurrentMailbox(client);
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to move emails",
        isLoading: false
      });
    }
  },

  batchArchive: async (client) => {
    const { selectedEmailIds, emails, mailboxes, fetchMailboxes } = get();
    if (selectedEmailIds.size === 0) return;

    const archiveMailbox = mailboxes.find(m => m.role === 'archive' || m.name.toLowerCase() === 'archive');
    if (!archiveMailbox) return;

    const mode = useSettingsStore.getState().archiveMode;
    const archiveId = archiveMailbox.originalId || archiveMailbox.id;

    const selected = emails.filter(e => selectedEmailIds.has(e.id));
    if (selected.length === 0) return;

    set({ isLoading: true, error: null });
    try {
      await client.batchArchiveEmails(
        selected.map(e => ({ id: e.id, receivedAt: e.receivedAt })),
        archiveId,
        mode,
        mailboxes,
        archiveMailbox.accountId,
      );

      const remaining = emails.filter(e => !selectedEmailIds.has(e.id));
      set({ emails: remaining, selectedEmailIds: new Set(), isLoading: false });

      await fetchMailboxes(client);
      // Refresh the current mailbox view (honors active search/filters)
      await get().refreshCurrentMailbox(client);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to archive emails',
        isLoading: false,
      });
      throw error;
    }
  },

  // Spam operations are provided by the SpamSlice spread above.

  // Push notification handlers are provided by the PushSlice spread above.

  // Thread expansion actions are provided by the ThreadSlice spread above.

  // Mailbox management
  createMailbox: async (client, name, parentId) => {
    try {
      await client.createMailbox(name, parentId);
      await get().fetchMailboxes(client);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create folder' });
      throw error;
    }
  },

  renameMailbox: async (client, mailboxId, name) => {
    try {
      await client.updateMailbox(mailboxId, { name });
      set({
        mailboxes: get().mailboxes.map(mb =>
          mb.id === mailboxId ? { ...mb, name } : mb
        ),
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to rename folder' });
      throw error;
    }
  },

  deleteMailbox: async (client, mailboxId) => {
    try {
      await client.deleteMailbox(mailboxId);
      const { mailboxes, selectedMailbox } = get();
      const newMailboxes = mailboxes.filter(mb => mb.id !== mailboxId);
      const updates: Partial<EmailStore> = { mailboxes: newMailboxes };
      // If the deleted mailbox was selected, switch to inbox
      if (selectedMailbox === mailboxId) {
        const inbox = newMailboxes.find(mb => mb.role === 'inbox' && !mb.isShared);
        if (inbox) {
          updates.selectedMailbox = inbox.id;
        }
      }
      set(updates as EmailStore);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete folder' });
      throw error;
    }
  },

  setMailboxRole: async (client, mailboxId, role) => {
    try {
      // If assigning a role, first clear that role from ALL other mailboxes that have it
      if (role) {
        const existingMailboxes = get().mailboxes.filter(mb => mb.role === role && !mb.isShared && mb.id !== mailboxId);
        for (const existing of existingMailboxes) {
          await client.updateMailbox(existing.id, { role: null });
        }
      }
      await client.updateMailbox(mailboxId, { role });
      await get().fetchMailboxes(client);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update folder role' });
      throw error;
    }
  },

  emptyMailbox: async (client, mailboxId) => {
    try {
      set({ isLoading: true, error: null });
      await client.emptyMailbox(mailboxId);

      // Clear emails from local state if we're viewing this mailbox
      const currentMailbox = get().selectedMailbox;
      if (currentMailbox === mailboxId) {
        set({ emails: [], selectedEmail: null });
      }

      // Update mailbox counters
      set({
        mailboxes: get().mailboxes.map(mb =>
          mb.id === mailboxId
            ? { ...mb, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0 }
            : mb
        ),
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to empty folder',
        isLoading: false,
      });
      throw error;
    }
  },

  markMailboxAsRead: async (client, mailboxId) => {
    try {
      const mailbox = get().mailboxes.find(mb => mb.id === mailboxId);
      const accountId = mailbox?.isShared ? mailbox.accountId : undefined;
      const jmapMailboxId = mailbox?.originalId || mailboxId;

      const count = await client.markMailboxAsRead(jmapMailboxId, accountId);

      // Update local state: mark all emails currently visible in this mailbox as read,
      // and zero-out the mailbox unread counter.
      set((state) => ({
        emails: state.emails.map(e =>
          e.mailboxIds && e.mailboxIds[mailboxId]
            ? { ...e, keywords: { ...e.keywords, $seen: true } }
            : e
        ),
        selectedEmail: state.selectedEmail && state.selectedEmail.mailboxIds?.[mailboxId]
          ? { ...state.selectedEmail, keywords: { ...state.selectedEmail.keywords, $seen: true } }
          : state.selectedEmail,
        mailboxes: state.mailboxes.map(mb =>
          mb.id === mailboxId
            ? { ...mb, unreadEmails: 0, unreadThreads: 0 }
            : mb
        ),
      }));

      return count;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to mark folder as read' });
      throw error;
    }
  },

  // Unified mailbox operations are provided by the UnifiedSlice spread above.

  loadMockData: () => {
    const mockEmails: Email[] = [
      {
        id: "1",
        threadId: "thread-1",
        mailboxIds: { inbox: true },
        keywords: { $seen: false },
        size: 1024,
        receivedAt: new Date().toISOString(),
        from: [{ name: "GitHub", email: "notifications@github.com" }],
        to: [{ email: "you@example.com" }],
        subject: "[ordo-nuntius] New pull request #42: Add OAuth2 module",
        preview: "dependabot[bot] opened a pull request in ordokr/OrdoNuntius. This PR adds a comprehensive authentication module with OAuth2 PKCE support...",
        hasAttachment: false,
      },
      {
        id: "2",
        threadId: "thread-2",
        mailboxIds: { inbox: true },
        keywords: { $seen: true, $flagged: true },
        size: 512,
        receivedAt: new Date(Date.now() - 3600000).toISOString(),
        from: [{ name: "Emily Chen", email: "emily.chen@gmail.com" }],
        to: [{ email: "you@example.com" }],
        subject: "Re: Dashboard Redesign v2 - feedback",
        preview: "Hey! I just pushed the updated mockups to Figma. I incorporated all the feedback from last week's meeting. Let me know what you think about the new nav...",
        hasAttachment: true,
      },
      {
        id: "3",
        threadId: "thread-3",
        mailboxIds: { inbox: true },
        keywords: { $seen: false },
        size: 2048,
        receivedAt: new Date(Date.now() - 7200000).toISOString(),
        from: [{ name: "Slack", email: "notifications@slack.com" }],
        to: [{ email: "you@example.com" }],
        subject: "3 new messages in #engineering",
        preview: "Marcus: Hey team, the CI pipeline is green again. Sarah: Great, merging the feature branch now. Alex: Let's do a quick sync at 3 PM...",
        hasAttachment: false,
      },
      {
        id: "4",
        threadId: "thread-4",
        mailboxIds: { inbox: true },
        keywords: { $seen: true },
        size: 768,
        receivedAt: new Date(Date.now() - 14400000).toISOString(),
        from: [{ name: "Marcus Rivera", email: "marcus.rivera@outlook.com" }],
        to: [{ email: "you@example.com" }],
        subject: "Quick question about the API rate limits",
        preview: "Hey, I was looking at the JMAP spec and I'm not sure how we should handle rate limiting on the server side. Do you have any thoughts on...",
        hasAttachment: false,
      },
      {
        id: "5",
        threadId: "thread-5",
        mailboxIds: { inbox: true },
        keywords: { $seen: true },
        size: 1536,
        receivedAt: new Date(Date.now() - 86400000).toISOString(),
        from: [{ name: "Stripe", email: "receipts@stripe.com" }],
        to: [{ email: "you@example.com" }],
        subject: "Your invoice from Acme Corp is ready",
        preview: "Invoice #INV-2026-0312 for $49.00 has been paid. Thank you for your payment. View your receipt and download your invoice...",
        hasAttachment: true,
      },
      {
        id: "6",
        threadId: "thread-6",
        mailboxIds: { inbox: true },
        keywords: { $seen: false },
        size: 3072,
        receivedAt: new Date(Date.now() - 108000000).toISOString(),
        from: [{ name: "Sarah Kim", email: "sarah.kim@proton.me" }],
        to: [{ email: "you@example.com" }],
        subject: "Conference talk proposal - need your review",
        preview: "I'm submitting a talk to ReactConf about our email client architecture. Could you take a look at my abstract before the deadline on Friday?...",
        hasAttachment: true,
      },
      {
        id: "7",
        threadId: "thread-7",
        mailboxIds: { inbox: true },
        keywords: { $seen: true, $flagged: true },
        size: 4096,
        receivedAt: new Date(Date.now() - 172800000).toISOString(),
        from: [{ name: "Vercel", email: "notifications@vercel.com" }],
        to: [{ email: "you@example.com" }],
        subject: "Deployment successful: ordo-nuntius \u2192 Production",
        preview: "Your project ordo-nuntius has been deployed to production. Build completed in 47s. All checks passed. Preview: https://ordo-nuntius.vercel.app...",
        hasAttachment: false,
      },
      {
        id: "8",
        threadId: "thread-8",
        mailboxIds: { inbox: true },
        keywords: { $seen: true },
        size: 2560,
        receivedAt: new Date(Date.now() - 259200000).toISOString(),
        from: [{ name: "Alex Petrov", email: "alex.petrov@fastmail.com" }],
        to: [{ email: "you@example.com" }],
        subject: "Meeting notes from yesterday's standup",
        preview: "Here are the action items from yesterday. 1) Finish the drag-and-drop implementation by Wednesday. 2) Review the accessibility audit results...",
        hasAttachment: false,
      },
      {
        id: "9",
        threadId: "thread-9",
        mailboxIds: { inbox: true },
        keywords: { $seen: false },
        size: 1280,
        receivedAt: new Date(Date.now() - 345600000).toISOString(),
        from: [{ name: "Linear", email: "notifications@linear.app" }],
        to: [{ email: "you@example.com" }],
        subject: "ENG-384: Implement email threading view \u2014 moved to In Progress",
        preview: "Alice Johnson moved ENG-384 to In Progress. This issue covers implementing the conversation thread view for the email client...",
        hasAttachment: false,
      },
      {
        id: "10",
        threadId: "thread-10",
        mailboxIds: { inbox: true },
        keywords: { $seen: true },
        size: 896,
        receivedAt: new Date(Date.now() - 432000000).toISOString(),
        from: [{ name: "Priya Sharma", email: "priya.sharma@icloud.com" }],
        to: [{ email: "you@example.com" }],
        subject: "Re: Onboarding docs for new contributors",
        preview: "Thanks for putting this together! I added a section on setting up the dev environment. Also linked the architecture diagram from our wiki...",
        hasAttachment: false,
      },
      {
        id: "11",
        threadId: "thread-11",
        mailboxIds: { inbox: true },
        keywords: { $seen: true },
        size: 5120,
        receivedAt: new Date(Date.now() - 518400000).toISOString(),
        from: [{ name: "LaunchWeekly", email: "newsletter@launchweekly.com" }],
        to: [{ email: "you@example.com" }],
        subject: "\uD83D\uDE80 This week in tech: AI agents, new frameworks, and more",
        preview: "Happy Monday! Here's your weekly roundup of the most interesting launches, open-source projects, and developer tools you might have missed...",
        hasAttachment: false,
      },
    ];

    const mockMailboxes: Mailbox[] = [
      {
        id: "inbox",
        name: "Inbox",
        role: "inbox",
        sortOrder: 1,
        totalEmails: 11,
        unreadEmails: 4,
        totalThreads: 11,
        unreadThreads: 4,
        myRights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          mayCreateChild: true,
          mayRename: true,
          mayDelete: true,
          maySubmit: true,
        },
        isSubscribed: true,
      },
    ];

    set({
      emails: mockEmails,
      mailboxes: mockMailboxes,
    });
  },

  clearState: () => {
    // Reset every field to its initial value. Single source of truth
    // for the email-store shape — account-state-manager used to
    // hardcode this list and would drift whenever a new field was
    // added (e.g. spamUndoCache, processingReadStatus, isLoadingMore,
    // lastSelectedEmailId, searchAbortController, externalSearchResults
    // were all missing from the manager's reset before this).
    set({
      emails: [],
      mailboxes: [],
      selectedEmail: null,
      selectedEmailIds: new Set(),
      lastSelectedEmailId: null,
      selectedMailbox: "",
      isLoading: false,
      isLoadingEmail: false,
      isLoadingMore: false,
      error: null,
      searchQuery: "",
      quota: null,
      processingReadStatus: new Set(),
      hasMoreEmails: false,
      totalEmails: 0,
      isPushConnected: false,
      lastPushUpdate: null,
      newEmailNotification: null,
      expandedThreadIds: new Set(),
      threadEmailsCache: new Map(),
      isLoadingThread: null,
      selectedKeyword: null,
      tagCounts: {},
      searchFilters: { ...DEFAULT_SEARCH_FILTERS },
      isAdvancedSearchOpen: false,
      searchAbortController: null,
      externalSearchResults: [],
      isUnifiedView: false,
      unifiedRole: null,
      unifiedErrors: new Map(),
      unifiedCounts: [],
      spamUndoCache: new Map(),
    });
  },
}));
