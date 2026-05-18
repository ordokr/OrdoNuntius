/**
 * Manages per-account state snapshots for fast switching.
 * When user switches from Account A → B, we snapshot A's store state
 * into memory, clear stores, then restore B's cached state.
 */

import { useEmailStore } from '@/stores/email-store';
import { useContactStore } from '@/stores/contact-store';
import { useCalendarStore } from '@/stores/calendar-store';
import { useFilterStore } from '@/stores/filter-store';
import { useIdentityStore } from '@/stores/identity-store';
import { useVacationStore } from '@/stores/vacation-store';
import { useSmimeStore } from '@/stores/smime-store';

// Minimal snapshot shapes - we only capture what we need
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoreSnapshot = Record<string, any>;

interface AccountSnapshot {
  email: StoreSnapshot;
  contact: StoreSnapshot;
  calendar: StoreSnapshot;
  filter: StoreSnapshot;
  identity: StoreSnapshot;
  vacation: StoreSnapshot;
}

const cache = new Map<string, AccountSnapshot>();

/** Capture current store states for the given account */
export function snapshotAccount(accountId: string): void {
  const emailState = useEmailStore.getState();
  const contactState = useContactStore.getState();
  const calendarState = useCalendarStore.getState();
  const filterState = useFilterStore.getState();
  const identityState = useIdentityStore.getState();
  const vacationState = useVacationStore.getState();

  cache.set(accountId, {
    email: {
      emails: emailState.emails,
      mailboxes: emailState.mailboxes,
      selectedEmail: emailState.selectedEmail,
      selectedMailbox: emailState.selectedMailbox,
      searchQuery: emailState.searchQuery,
      quota: emailState.quota,
    },
    contact: {
      contacts: contactState.contacts,
      addressBooks: contactState.addressBooks,
      supportsSync: contactState.supportsSync,
    },
    calendar: {
      calendars: calendarState.calendars,
      events: calendarState.events,
      selectedCalendarIds: calendarState.selectedCalendarIds,
      viewMode: calendarState.viewMode,
      supportsCalendar: calendarState.supportsCalendar,
    },
    filter: {
      rules: filterState.rules,
      isSupported: filterState.isSupported,
    },
    identity: {
      identities: identityState.identities,
      preferredPrimaryId: identityState.preferredPrimaryId,
    },
    vacation: {
      isEnabled: vacationState.isEnabled,
      isSupported: vacationState.isSupported,
    },
  });
}

/** Restore cached store states for the given account. Returns false if no cache exists. */
export function restoreAccount(accountId: string): boolean {
  const snapshot = cache.get(accountId);
  if (!snapshot) return false;

  useEmailStore.setState(snapshot.email);
  useContactStore.setState(snapshot.contact);
  useCalendarStore.setState(snapshot.calendar);
  useFilterStore.setState(snapshot.filter);
  useIdentityStore.setState(snapshot.identity);
  useVacationStore.setState(snapshot.vacation);

  return true;
}

/** Clear all stores (used before restoring a different account) */
export function clearAllStores(): void {
  // Each store owns its own reset. Was previously hardcoded here for
  // email-store and drifted out of sync (processingReadStatus,
  // spamUndoCache, isLoadingMore, lastSelectedEmailId,
  // searchAbortController, externalSearchResults all leaked across
  // account switches because they weren't listed). Now the single
  // source of truth is `useEmailStore.clearState()`.
  useEmailStore.getState().clearState();
  useIdentityStore.getState().clearIdentities();
  useContactStore.getState().clearContacts();
  useVacationStore.getState().clearState();
  useCalendarStore.getState().clearState();
  useFilterStore.getState().clearState();
  useSmimeStore.getState().clearState();
}

/** Evict cached state for one account */
export function evictAccount(accountId: string): void {
  cache.delete(accountId);
}

/** Evict all cached states */
export function evictAll(): void {
  cache.clear();
}
