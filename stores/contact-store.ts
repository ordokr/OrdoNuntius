import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContactCard, AddressBook, AddressBookRights, ContactName } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { generateUUID } from '@/lib/utils';
import { debug } from '@/lib/debug';

// Search index — lazy WeakMap cache of pre-lowercased name + emails per
// contact. getAutocomplete walks every contact on every keystroke; without
// this it allocates and lowercases the display name + every email address
// per contact per call. WeakMap entries are GC'd automatically when a
// contact is no longer referenced (e.g. after a refresh that swaps the
// list), so no eviction is needed.
interface ContactSearchIndex {
  lowerName: string;
  /** address + pre-lowercased copy, paired so consumers iterate once. */
  emails: ReadonlyArray<{ address: string; lower: string }>;
}
const _contactSearchIndex = new WeakMap<ContactCard, ContactSearchIndex>();

// Email → contact index. Avatar's per-row lookup walks every contact ×
// every email per render before this — O(N×M) per visible email row.
// Building a Map once per contact-array reference and caching it
// against that same reference (so identity-equal arrays share the
// index) makes Avatar's lookup O(1). Recomputes when contacts mutates.
const _contactByEmailIndex = new WeakMap<readonly ContactCard[], Map<string, ContactCard>>();
function getContactByEmailIndex(contacts: readonly ContactCard[]): Map<string, ContactCard> {
  const cached = _contactByEmailIndex.get(contacts);
  if (cached) return cached;
  const index = new Map<string, ContactCard>();
  // `for...in` over contact.emails avoids the per-contact `Object.values`
  // throwaway array. With a 10k-contact address book that's 10k allocs
  // dropped from the cold-index build.
  for (const contact of contacts) {
    if (!contact.emails) continue;
    for (const k in contact.emails) {
      const addr = contact.emails[k]?.address;
      if (!addr) continue;
      const key = addr.toLowerCase();
      // First-wins: if two contacts share an email, the earlier-listed
      // one wins. Matches the order-dependent behavior of the prior
      // for-of-Object.values lookup loop in Avatar.
      if (!index.has(key)) index.set(key, contact);
    }
  }
  _contactByEmailIndex.set(contacts, index);
  return index;
}

/**
 * O(1) lookup of a contact by any of its email addresses. The index
 * is built lazily and cached against the contacts array's identity,
 * so back-to-back lookups (e.g. the avatar in every visible email
 * row) share one index build.
 */
export function findContactByEmail(
  contacts: readonly ContactCard[],
  email: string,
): ContactCard | undefined {
  if (!email) return undefined;
  return getContactByEmailIndex(contacts).get(email.toLowerCase());
}

function getContactSearchIndex(contact: ContactCard): ContactSearchIndex {
  const cached = _contactSearchIndex.get(contact);
  if (cached) return cached;
  const lowerName = getContactDisplayName(contact).toLowerCase();
  // Pre-compute address + lowercased address pairs in one pass. Previous
  // shape built `lowerEmails` index-aligned with `Object.values(contact.
  // emails)` and forced consumers to call `Object.values` *again* to walk
  // the pairs — duplicate allocation. The new shape carries the address
  // with its lowercase so consumers iterate one array, no second alloc.
  const emails: Array<{ address: string; lower: string }> = [];
  if (contact.emails) {
    for (const k in contact.emails) {
      const addr = contact.emails[k]?.address;
      if (!addr) continue;
      emails.push({ address: addr, lower: addr.toLowerCase() });
    }
  }
  const entry: ContactSearchIndex = { lowerName, emails };
  _contactSearchIndex.set(contact, entry);
  return entry;
}

// Return the first value in a Record without allocating the values-array
// that `Object.values(rec)[0]` builds. Used for "pick the primary X" on
// RFC 9553 contact fields — they're keyed Records but the rendering
// pipeline only ever wants the first entry.
function firstValueOf<T>(rec: Record<string, T> | undefined): T | undefined {
  if (!rec) return undefined;
  for (const k in rec) return rec[k];
  return undefined;
}

export function getContactDisplayName(contact: ContactCard): string {
  if (contact.name) {
    // Try given + surname from components first
    if (contact.name.components && contact.name.components.length > 0) {
      const given = contact.name.components.find(c => c.kind === 'given')?.value || '';
      const surname = contact.name.components.find(c => c.kind === 'surname')?.value || '';
      const full = [given, surname].filter(Boolean).join(' ');
      if (full) return full;
    }
    // Fall back to name.full (RFC 9553 - used by Stalwart and other JMAP servers)
    if (contact.name.full) return contact.name.full;
  }
  const nick = firstValueOf(contact.nicknames);
  if (nick?.name) return nick.name;
  const org = firstValueOf(contact.organizations);
  if (org?.name) return org.name;
  const email = firstValueOf(contact.emails);
  if (email?.address) return email.address;
  return '';
}

export function getContactPrimaryEmail(contact: ContactCard): string {
  return firstValueOf(contact.emails)?.address || '';
}

export function getContactPhotoUri(contact: ContactCard): string | undefined {
  if (!contact.media) return undefined;
  // for...in over the media Record skips the Object.values array
  // allocation. Called per contact row in list renders + per-contact
  // photo filter — hot enough to matter on large contact books.
  const media = contact.media;
  for (const k in media) {
    const m = media[k];
    if (m.kind === 'photo' && m.uri) return m.uri;
  }
  return undefined;
}

/**
 * Count active members of a group's `members` map. The shape is
 * `Record<string, boolean>` — `true` means active, `false` (or missing)
 * means inactive. Was previously inlined in two list renders as
 * `Object.values(group.members).filter(Boolean).length` which allocates a
 * values-array AND a filtered-array per group per render. The direct
 * `for...in` walk avoids both.
 */
export function countActiveGroupMembers(members: Record<string, boolean> | undefined): number {
  if (!members) return 0;
  let n = 0;
  for (const k in members) {
    if (members[k]) n++;
  }
  return n;
}

export const TRUSTED_SENDERS_BOOK_NAME = 'Trusted Senders';

interface ContactStore {
  contacts: ContactCard[];
  addressBooks: AddressBook[];
  selectedContactId: string | null;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  supportsSync: boolean;

  // Trusted senders address book cache (runtime only, not persisted)
  trustedSenderEmails: string[];
  trustedSendersBookId: string | null;
  trustedSendersLoaded: boolean;
  trustedSendersLoading: boolean;

  selectedContactIds: Set<string>;
  lastSelectedContactId: string | null;
  activeTab: 'all' | 'groups';

  fetchContacts: (client: IJMAPClient) => Promise<void>;
  fetchAddressBooks: (client: IJMAPClient) => Promise<void>;
  createContact: (client: IJMAPClient, contact: Partial<ContactCard>) => Promise<void>;
  updateContact: (client: IJMAPClient, id: string, updates: Partial<ContactCard>) => Promise<void>;
  deleteContact: (client: IJMAPClient, id: string) => Promise<void>;

  addLocalContact: (contact: ContactCard) => void;
  updateLocalContact: (id: string, updates: Partial<ContactCard>) => void;
  deleteLocalContact: (id: string) => void;

  setSelectedContact: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSupportsSync: (supports: boolean) => void;
  setActiveTab: (tab: 'all' | 'groups') => void;
  clearContacts: () => void;

  getAutocomplete: (query: string) => Array<{ name: string; email: string }>;

  getGroups: () => ContactCard[];
  getIndividuals: () => ContactCard[];
  getGroupMembers: (groupId: string) => ContactCard[];
  createGroup: (client: IJMAPClient | null, name: string, memberIds: string[]) => Promise<void>;
  updateGroup: (client: IJMAPClient | null, groupId: string, name: string) => Promise<void>;
  addMembersToGroup: (client: IJMAPClient | null, groupId: string, memberIds: string[]) => Promise<void>;
  removeMembersFromGroup: (client: IJMAPClient | null, groupId: string, memberIds: string[]) => Promise<void>;
  deleteGroup: (client: IJMAPClient | null, groupId: string) => Promise<void>;

  toggleContactSelection: (id: string) => void;
  selectRangeContacts: (targetId: string, sortedIds: string[]) => void;
  selectAllContacts: (ids: string[]) => void;
  clearSelection: () => void;
  bulkDeleteContacts: (client: IJMAPClient | null, ids: string[]) => Promise<void>;
  bulkAddToGroup: (client: IJMAPClient | null, groupId: string, contactIds: string[]) => Promise<void>;
  moveContactToAddressBook: (client: IJMAPClient, contactIds: string[], addressBook: AddressBook) => Promise<void>;
  renameAddressBook: (client: IJMAPClient, addressBook: AddressBook, newName: string) => Promise<void>;
  removeAddressBook: (client: IJMAPClient, addressBook: AddressBook) => Promise<void>;
  shareAddressBook: (client: IJMAPClient, addressBook: AddressBook, principalId: string, rights: AddressBookRights | null) => Promise<void>;
  renameKeyword: (client: IJMAPClient | null, oldKeyword: string, newKeyword: string) => Promise<void>;

  importContacts: (client: IJMAPClient | null, contacts: ContactCard[]) => Promise<number>;

  // Trusted senders address book
  loadTrustedSendersBook: (client: IJMAPClient) => Promise<void>;
  addToTrustedSendersBook: (client: IJMAPClient, email: string) => Promise<void>;
  removeFromTrustedSendersBook: (client: IJMAPClient, email: string) => Promise<void>;
  isTrustedAddressBookSender: (email: string) => boolean;
}

export const useContactStore = create<ContactStore>()(
  persist(
    (set, get) => {

      // Clean group member references when contacts are removed
      function cleanGroupMembers(contacts: ContactCard[], removedIds: Set<string>): ContactCard[] {
        // Collect uid/id variants of removed contacts for matching
        const removedKeys = new Set<string>();
        for (const c of contacts) {
          if (!removedIds.has(c.id)) continue;
          removedKeys.add(c.id);
          if (c.uid) {
            removedKeys.add(c.uid);
            const bare = c.uid.startsWith('urn:uuid:') ? c.uid.slice(9) : c.uid;
            removedKeys.add(bare);
          }
          if (c.originalId) removedKeys.add(c.originalId);
        }
        return contacts.map(c => {
          if (c.kind !== 'group' || !c.members) return c;
          let changed = false;
          const newMembers: Record<string, boolean> = {};
          // for...in avoids the Object.entries Array-of-tuples allocation.
          // Groups can hold 100-500 members; over a multi-contact delete this
          // skipped allocation matters.
          const members = c.members;
          for (const key in members) {
            const bareKey = key.startsWith('urn:uuid:') ? key.slice(9) : key;
            if (removedKeys.has(key) || removedKeys.has(bareKey)) {
              changed = true;
            } else {
              newMembers[key] = members[key];
            }
          }
          return changed ? { ...c, members: newMembers } : c;
        });
      }

      return ({
      contacts: [],
      addressBooks: [],
      selectedContactId: null,
      searchQuery: '',
      isLoading: false,
      error: null,
      supportsSync: false,
      trustedSenderEmails: [],
      trustedSendersBookId: null,
      trustedSendersLoaded: false,
      trustedSendersLoading: false,
      selectedContactIds: new Set<string>(),
      lastSelectedContactId: null,
      activeTab: 'all' as const,

      fetchContacts: async (client) => {
        set({ isLoading: true, error: null });
        try {
          const contacts = await client.getAllContacts();
          set({ contacts, isLoading: false });
        } catch (error) {
          console.error('Failed to fetch contacts:', error);
          set({ error: 'Failed to fetch contacts', isLoading: false });
        }
      },

      fetchAddressBooks: async (client) => {
        try {
          const addressBooks = await client.getAllAddressBooks();
          set({ addressBooks });
        } catch (error) {
          console.error('Failed to fetch address books:', error);
          set({ error: 'Failed to fetch address books' });
        }
      },

      createContact: async (client, contact) => {
        set({ isLoading: true, error: null });
        try {
          // Determine target account from the selected address book
          let accountId = contact.isShared ? contact.accountId : undefined;
          let cleanedContact = contact;

          // De-namespace addressBookIds if they reference a shared address book.
          // O(1) book lookup via Map; was .find per bookId. for...in over the
          // Record skips the Object.entries tuples-array.
          if (contact.addressBookIds) {
            const books = get().addressBooks;
            const bookById = new Map<string, typeof books[number]>();
            for (const b of books) bookById.set(b.id, b);
            const deNamespaced: Record<string, boolean> = {};
            let sharedAccountId: string | undefined;
            const ids = contact.addressBookIds;
            for (const bookId in ids) {
              const value = ids[bookId];
              const book = bookById.get(bookId);
              if (book?.isShared && book.originalId) {
                deNamespaced[book.originalId] = value;
                sharedAccountId = book.accountId;
              } else {
                deNamespaced[bookId] = value;
              }
            }
            if (sharedAccountId) {
              accountId = sharedAccountId;
              cleanedContact = { ...contact, addressBookIds: deNamespaced, isShared: true, accountId: sharedAccountId };
            } else {
              cleanedContact = { ...contact, addressBookIds: deNamespaced };
            }
          }

          const created = await client.createContact(cleanedContact, accountId);
          // Preserve shared account metadata
          if (contact.isShared && contact.accountId) {
            created.accountId = contact.accountId;
            created.accountName = contact.accountName;
            created.isShared = true;
            created.id = `${contact.accountId}:${created.id}`;
            created.originalId = created.id.includes(':') ? created.id.split(':').slice(1).join(':') : created.id;
          }
          set((state) => ({
            contacts: [...state.contacts, created],
            isLoading: false,
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to create contact';
          set({ error: msg, isLoading: false });
          throw error;
        }
      },

      updateContact: async (client, id, updates) => {
        set({ error: null });
        try {
          const contact = get().contacts.find(c => c.id === id);
          const originalId = contact?.originalId || id;
          const accountId = contact?.isShared ? contact.accountId : undefined;

          // De-namespace addressBookIds for shared contacts before sending to JMAP server
          let cleanedUpdates = updates;
          if (contact?.isShared && contact?.accountId && updates.addressBookIds) {
            const prefix = `${contact.accountId}:`;
            // Direct build skips Object.fromEntries + entries.map sub-arrays.
            const deNamespaced: Record<string, boolean> = {};
            const src = updates.addressBookIds;
            for (const k in src) {
              const stripped = k.startsWith(prefix) ? k.slice(prefix.length) : k;
              deNamespaced[stripped] = src[k];
            }
            cleanedUpdates = { ...updates, addressBookIds: deNamespaced };
          }

          await client.updateContact(originalId, cleanedUpdates, accountId);
          set((state) => ({
            contacts: state.contacts.map(c =>
              c.id === id ? { ...c, ...updates } : c
            ),
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to update contact';
          set({ error: msg });
          throw error;
        }
      },

      deleteContact: async (client, id) => {
        set({ error: null });
        try {
          const contact = get().contacts.find(c => c.id === id);
          const originalId = contact?.originalId || id;
          const accountId = contact?.isShared ? contact.accountId : undefined;
          await client.deleteContact(originalId, accountId);
          set((state) => {
            const removedIds = new Set([id]);
            const cleaned = cleanGroupMembers(state.contacts, removedIds);
            return {
              contacts: cleaned.filter(c => c.id !== id),
              selectedContactId: state.selectedContactId === id ? null : state.selectedContactId,
            };
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to delete contact';
          set({ error: msg });
          throw error;
        }
      },

      addLocalContact: (contact) => set((state) => ({
        contacts: [...state.contacts, contact],
      })),

      updateLocalContact: (id, updates) => set((state) => ({
        contacts: state.contacts.map(c =>
          c.id === id ? { ...c, ...updates } : c
        ),
      })),

      deleteLocalContact: (id) => set((state) => {
        const removedIds = new Set([id]);
        const cleaned = cleanGroupMembers(state.contacts, removedIds);
        return {
          contacts: cleaned.filter(c => c.id !== id),
          selectedContactId: state.selectedContactId === id ? null : state.selectedContactId,
        };
      }),

      setSelectedContact: (id) => set({ selectedContactId: id }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSupportsSync: (supports) => set({ supportsSync: supports }),
      setActiveTab: (tab) => set({ activeTab: tab }),

      clearContacts: () => set({
        contacts: [],
        addressBooks: [],
        selectedContactId: null,
        searchQuery: '',
        error: null,
        selectedContactIds: new Set<string>(),
        activeTab: 'all',
      }),

      getAutocomplete: (query) => {
        const { contacts } = get();
        if (!query || query.length < 1) return [];

        const lower = query.toLowerCase();
        const results: Array<{ name: string; email: string }> = [];
        const MAX_RESULTS = 10;

        for (const contact of contacts) {
          if (results.length >= MAX_RESULTS) break;

          if (contact.kind === 'group') {
            // Lowercase the group name via the search index so we don't
            // re-allocate on every keystroke.
            const groupIdx = getContactSearchIndex(contact);
            if (groupIdx.lowerName.includes(lower)) {
              const members = get().getGroupMembers(contact.id);
              for (const member of members) {
                if (results.length >= MAX_RESULTS) break;
                const memberName = getContactDisplayName(member);
                // `for...in` avoids per-member `Object.values` allocation.
                if (!member.emails) continue;
                for (const k in member.emails) {
                  if (results.length >= MAX_RESULTS) break;
                  const addr = member.emails[k]?.address;
                  if (addr) results.push({ name: memberName, email: addr });
                }
              }
            }
            continue;
          }

          // Pre-lowercased name + emails (cached in WeakMap per contact).
          // Walk the paired array directly — was re-deriving the same list
          // via `Object.values(contact.emails)` per iteration, doubling
          // allocation cost.
          const idx = getContactSearchIndex(contact);
          const nameMatches = idx.lowerName.includes(lower);
          for (const e of idx.emails) {
            if (results.length >= MAX_RESULTS) break;
            if (nameMatches || e.lower.includes(lower)) {
              // Compute the display name lazily — only when we have a hit,
              // not for every contact we scan past.
              const name = getContactDisplayName(contact);
              results.push({ name, email: e.address });
            }
          }
        }

        return results;
      },

      getGroups: () => {
        return get().contacts.filter(c => c.kind === 'group');
      },

      getIndividuals: () => {
        return get().contacts.filter(c => c.kind !== 'group');
      },

      getGroupMembers: (groupId) => {
        const { contacts } = get();
        const group = contacts.find(c => c.id === groupId);
        if (!group?.members) return [];
        // Sets give O(1) membership checks. Was O(M × K) with two
        // Array.includes per contact; now O(M + K).
        const memberKeys = new Set(
          Object.keys(group.members).filter(k => group.members![k])
        );
        const normalizedKeys = new Set<string>();
        for (const k of memberKeys) {
          normalizedKeys.add(k.startsWith('urn:uuid:') ? k.slice(9) : k);
        }
        return contacts.filter(c => {
          if (memberKeys.has(c.id) || normalizedKeys.has(c.id)) return true;
          if (c.uid) {
            const bareUid = c.uid.startsWith('urn:uuid:') ? c.uid.slice(9) : c.uid;
            return memberKeys.has(c.uid) || normalizedKeys.has(bareUid);
          }
          return false;
        });
      },

      createGroup: async (client, name, memberIds) => {
        const { contacts } = get();
        // Was O(memberIds × contacts): per id, `.find(c => c.id === id)`
        // walked the whole contacts array. Index once, lookup O(1).
        const byId = new Map(contacts.map(c => [c.id, c]));
        const members: Record<string, boolean> = {};
        for (const id of memberIds) {
          const contact = byId.get(id);
          members[contact?.uid || id] = true;
        }

        const groupData: Partial<ContactCard> = {
          kind: 'group',
          name: { components: [{ kind: 'given', value: name }], isOrdered: true },
          members,
        };

        if (client && get().supportsSync) {
          const created = await client.createContact(groupData);
          set((state) => ({ contacts: [...state.contacts, created] }));
        } else {
          const localGroup: ContactCard = {
            id: `local-${generateUUID()}`,
            addressBookIds: {},
            ...groupData,
          } as ContactCard;
          set((state) => ({ contacts: [...state.contacts, localGroup] }));
        }
      },

      updateGroup: async (client, groupId, name) => {
        const updates: Partial<ContactCard> = {
          name: { components: [{ kind: 'given', value: name }], isOrdered: true },
        };
        if (client && get().supportsSync) {
          const group = get().contacts.find(c => c.id === groupId);
          const originalId = group?.originalId || groupId;
          const accountId = group?.isShared ? group.accountId : undefined;
          await client.updateContact(originalId, updates, accountId);
        }
        set((state) => ({
          contacts: state.contacts.map(c =>
            c.id === groupId ? { ...c, ...updates } : c
          ),
        }));
      },

      addMembersToGroup: async (client, groupId, memberIds) => {
        const { contacts } = get();
        const group = contacts.find(c => c.id === groupId);
        if (!group) return;

        // Same O(memberIds × contacts) → O(memberIds + contacts) win as
        // createGroup. Build a by-id index once.
        const byId = new Map(contacts.map(c => [c.id, c]));
        const newMembers = { ...group.members };
        for (const id of memberIds) {
          const contact = byId.get(id);
          newMembers[contact?.uid || contact?.originalId || id] = true;
        }

        const updates: Partial<ContactCard> = { members: newMembers };
        if (client && get().supportsSync) {
          const originalId = group.originalId || groupId;
          const accountId = group.isShared ? group.accountId : undefined;
          await client.updateContact(originalId, updates, accountId);
        }
        set((state) => ({
          contacts: state.contacts.map(c =>
            c.id === groupId ? { ...c, members: newMembers } : c
          ),
        }));
      },

      removeMembersFromGroup: async (client, groupId, memberIds) => {
        const { contacts } = get();
        const group = contacts.find(c => c.id === groupId);
        if (!group?.members) return;

        // O(memberIds × contacts) → O(memberIds + contacts).
        const byId = new Map(contacts.map(c => [c.id, c]));
        const newMembers = { ...group.members };
        for (const id of memberIds) {
          // Try direct id match first
          if (newMembers[id] !== undefined) {
            delete newMembers[id];
            continue;
          }
          // Try uid-based match
          const contact = byId.get(id);
          if (contact?.uid && newMembers[contact.uid] !== undefined) {
            delete newMembers[contact.uid];
            continue;
          }
          // Try stripping urn:uuid: prefix matching
          const bareUid = contact?.uid?.startsWith('urn:uuid:') ? contact.uid.slice(9) : contact?.uid;
          for (const key in newMembers) {
            const bareKey = key.startsWith('urn:uuid:') ? key.slice(9) : key;
            if (bareKey === id || bareKey === bareUid) {
              delete newMembers[key];
              break;
            }
          }
        }

        const updates: Partial<ContactCard> = { members: newMembers };
        if (client && get().supportsSync) {
          const originalId = group.originalId || groupId;
          const accountId = group.isShared ? group.accountId : undefined;
          await client.updateContact(originalId, updates, accountId);
        }
        set((state) => ({
          contacts: state.contacts.map(c =>
            c.id === groupId ? { ...c, members: newMembers } : c
          ),
        }));
      },

      deleteGroup: async (client, groupId) => {
        if (client && get().supportsSync) {
          const group = get().contacts.find(c => c.id === groupId);
          const originalId = group?.originalId || groupId;
          const accountId = group?.isShared ? group.accountId : undefined;
          await client.deleteContact(originalId, accountId);
        }
        set((state) => ({
          contacts: state.contacts.filter(c => c.id !== groupId),
          selectedContactId: state.selectedContactId === groupId ? null : state.selectedContactId,
        }));
      },

      toggleContactSelection: (id) => set((state) => {
        const next = new Set(state.selectedContactIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { selectedContactIds: next, lastSelectedContactId: id };
      }),

      selectRangeContacts: (targetId, sortedIds) => {
        const { lastSelectedContactId, selectedContactIds } = get();
        const anchorId = lastSelectedContactId || sortedIds[0];
        if (!anchorId) return;
        const anchorIndex = sortedIds.indexOf(anchorId);
        const targetIndex = sortedIds.indexOf(targetId);
        if (anchorIndex === -1 || targetIndex === -1) return;
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const newSelection = new Set(selectedContactIds);
        for (let i = start; i <= end; i++) {
          newSelection.add(sortedIds[i]);
        }
        set({ selectedContactIds: newSelection });
      },

      selectAllContacts: (ids) => set({ selectedContactIds: new Set(ids) }),

      clearSelection: () => set({ selectedContactIds: new Set<string>(), lastSelectedContactId: null }),

      bulkDeleteContacts: async (client, ids) => {
        set({ error: null });
        const { supportsSync, contacts } = get();
        const deletedIds = new Set(ids);

        if (client && supportsSync) {
          for (const id of ids) {
            try {
              const contact = contacts.find(c => c.id === id);
              const originalId = contact?.originalId || id;
              const accountId = contact?.isShared ? contact.accountId : undefined;
              await client.deleteContact(originalId, accountId);
            } catch (error) {
              console.error(`Failed to delete contact ${id}:`, error);
              deletedIds.delete(id);
            }
          }
          if (deletedIds.size < ids.length) {
            set({ error: `Failed to delete ${ids.length - deletedIds.size} contact(s)` });
          }
        }

        set((state) => {
          const cleaned = cleanGroupMembers(state.contacts, deletedIds);
          return {
            contacts: cleaned.filter(c => !deletedIds.has(c.id)),
            selectedContactId: deletedIds.has(state.selectedContactId || '') ? null : state.selectedContactId,
            selectedContactIds: new Set<string>(),
          };
        });
      },

      bulkAddToGroup: async (client, groupId, contactIds) => {
        await get().addMembersToGroup(client, groupId, contactIds);
        set({ selectedContactIds: new Set<string>() });
      },

      moveContactToAddressBook: async (client, contactIds, addressBook) => {
        set({ error: null });
        const { contacts } = get();
        const targetBookOriginalId = addressBook.originalId || addressBook.id;
        const targetAccountId = addressBook.accountId;
        const primaryAccountId = client.getContactsAccountId();

        for (const id of contactIds) {
          const contact = contacts.find(c => c.id === id);
          if (!contact) continue;

          const originalId = contact.originalId || id;
          const sourceAccountId = contact.isShared ? contact.accountId : undefined;

          // Same account: just update the addressBookIds
          if ((sourceAccountId || primaryAccountId) === (targetAccountId || primaryAccountId)) {
            await client.updateContact(originalId, { addressBookIds: { [targetBookOriginalId]: true } }, sourceAccountId);
            const isTargetPrimary = !targetAccountId || targetAccountId === primaryAccountId;
            const localBookId = isTargetPrimary ? targetBookOriginalId : `${targetAccountId}:${targetBookOriginalId}`;
            set((state) => ({
              contacts: state.contacts.map(c =>
                c.id === id ? { ...c, addressBookIds: { [localBookId]: true } } : c
              ),
            }));
          } else {
            // Cross-account: create in target, delete from source
            const { originalId: _oid, accountId: _aid, accountName: _an, isShared: _is, id: _id, ...contactData } = contact;
            const newContact = await client.createContact(
              { ...contactData, addressBookIds: { [targetBookOriginalId]: true } },
              targetAccountId
            );
            await client.deleteContact(originalId, sourceAccountId);

            // Update local state
            const isPrimary = !targetAccountId || targetAccountId === primaryAccountId;
            const localBookId = isPrimary ? targetBookOriginalId : `${targetAccountId}:${targetBookOriginalId}`;
            set((state) => ({
              contacts: state.contacts.map(c => {
                if (c.id !== id) return c;
                return {
                  ...newContact,
                  id: isPrimary ? newContact.id : `${targetAccountId}:${newContact.id}`,
                  originalId: newContact.id,
                  accountId: targetAccountId,
                  accountName: addressBook.accountName || targetAccountId,
                  isShared: !isPrimary,
                  addressBookIds: { [localBookId]: true },
                };
              }),
            }));
          }
        }
      },

      renameAddressBook: async (client, addressBook, newName) => {
        set({ error: null });
        const trimmed = newName.trim();
        if (!trimmed) return;
        try {
          const originalId = addressBook.originalId || addressBook.id;
          const accountId = addressBook.isShared ? addressBook.accountId : undefined;
          await client.updateAddressBook(originalId, { name: trimmed }, accountId);
          set((state) => ({
            addressBooks: state.addressBooks.map(b =>
              b.id === addressBook.id ? { ...b, name: trimmed } : b
            ),
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to rename address book';
          set({ error: msg });
          throw error;
        }
      },

      removeAddressBook: async (client, addressBook) => {
        set({ error: null });
        try {
          const originalId = addressBook.originalId || addressBook.id;
          const accountId = addressBook.isShared ? addressBook.accountId : undefined;
          await client.deleteAddressBook(originalId, accountId);
          set((state) => ({
            addressBooks: state.addressBooks.filter(b => b.id !== addressBook.id),
            contacts: state.contacts.filter(c => !c.addressBookIds?.[addressBook.id]),
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to delete address book';
          set({ error: msg });
          throw error;
        }
      },

      shareAddressBook: async (client, addressBook, principalId, rights) => {
        set({ error: null });
        try {
          const originalId = addressBook.originalId || addressBook.id;
          const accountId = addressBook.isShared ? addressBook.accountId : undefined;
          await client.setAddressBookShare(originalId, principalId, rights, accountId);
          set((state) => ({
            addressBooks: state.addressBooks.map(b => {
              if (b.id !== addressBook.id) return b;
              const next = { ...(b.shareWith ?? {}) };
              if (rights === null) delete next[principalId];
              else next[principalId] = rights;
              return { ...b, shareWith: next };
            }),
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to share address book';
          set({ error: msg });
          throw error;
        }
      },

      renameKeyword: async (client, oldKeyword, newKeyword) => {
        set({ error: null });
        const oldKw = oldKeyword.trim();
        const newKw = newKeyword.trim();
        if (!oldKw || !newKw || oldKw === newKw) return;

        const { contacts, supportsSync } = get();
        const affected = contacts.filter(c => c.keywords?.[oldKw]);

        for (const contact of affected) {
          const { [oldKw]: _old, ...rest } = contact.keywords || {};
          const updatedKeywords: Record<string, boolean> = { ...rest, [newKw]: true };
          try {
            if (supportsSync && client) {
              const originalId = contact.originalId || contact.id;
              const accountId = contact.isShared ? contact.accountId : undefined;
              await client.updateContact(originalId, { keywords: updatedKeywords }, accountId);
            }
            set((state) => ({
              contacts: state.contacts.map(c =>
                c.id === contact.id ? { ...c, keywords: updatedKeywords } : c
              ),
            }));
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Failed to rename category';
            set({ error: msg });
            throw error;
          }
        }
      },

      loadTrustedSendersBook: async (client) => {
        if (get().trustedSendersLoading) return;
        set({ trustedSendersLoading: true });
        try {
          debug.log('contacts', 'Loading trusted senders address book');
          const books = await client.getAddressBooks();
          let book = books.find(b => b.name === TRUSTED_SENDERS_BOOK_NAME);
          if (!book) {
            debug.log('contacts', 'Creating new trusted senders address book');
            book = await client.createAddressBook(TRUSTED_SENDERS_BOOK_NAME);
          }
          const bookId = book.id;
          debug.log('contacts', 'Trusted senders book id:', bookId);
          const contacts = await client.getContacts(bookId);
          debug.log('contacts', 'Loaded', contacts.length, 'trusted sender contacts');
          // Single-pass walk. Was: per-contact `Object.values` + `.map`
          // + outer `.filter(Boolean)` — three allocations per contact
          // plus a top-level flatMap array. Now one output array.
          const emails: string[] = [];
          for (const c of contacts) {
            if (!c.emails) continue;
            for (const k in c.emails) {
              const addr = c.emails[k]?.address;
              if (addr) emails.push(addr.toLowerCase().trim());
            }
          }
          set({ trustedSendersBookId: bookId, trustedSenderEmails: emails, trustedSendersLoaded: true, trustedSendersLoading: false });
        } catch (error) {
          debug.error('Failed to load trusted senders address book:', error);
          set({ trustedSendersLoaded: true, trustedSendersLoading: false });
        }
      },

      addToTrustedSendersBook: async (client, email) => {
        const normalizedEmail = email.toLowerCase().trim();
        const { trustedSenderEmails } = get();
        if (trustedSenderEmails.includes(normalizedEmail)) return;

        let bookId = get().trustedSendersBookId;
        if (!bookId) {
          await get().loadTrustedSendersBook(client);
          bookId = get().trustedSendersBookId;
        }
        if (!bookId) throw new Error('Could not find or create trusted senders address book');

        debug.log('contacts', 'Adding trusted sender:', normalizedEmail, 'to book:', bookId);
        await client.createContact({
          addressBookIds: { [bookId]: true },
          emails: { email: { address: normalizedEmail } },
        });
        set((state) => ({ trustedSenderEmails: [...state.trustedSenderEmails, normalizedEmail] }));
        debug.log('contacts', 'Trusted sender added successfully');
      },

      removeFromTrustedSendersBook: async (client, email) => {
        const normalizedEmail = email.toLowerCase().trim();
        const { trustedSendersBookId } = get();
        if (!trustedSendersBookId) return;

        debug.log('contacts', 'Removing trusted sender:', normalizedEmail);
        const contacts = await client.getContacts(trustedSendersBookId);
        const match = contacts.find(c => {
          if (!c.emails) return false;
          const emails = c.emails;
          // for...in walk drops the Object.values allocation per contact
          // probed during the trusted-sender lookup.
          for (const k in emails) {
            if (emails[k].address.toLowerCase().trim() === normalizedEmail) return true;
          }
          return false;
        });
        if (match) {
          await client.deleteContact(match.id);
          debug.log('contacts', 'Trusted sender removed');
        }
        set((state) => ({ trustedSenderEmails: state.trustedSenderEmails.filter(e => e !== normalizedEmail) }));
      },

      isTrustedAddressBookSender: (email) => {
        const normalizedEmail = email.toLowerCase().trim();
        return get().trustedSenderEmails.includes(normalizedEmail);
      },

      importContacts: async (client, contacts) => {
        const { supportsSync } = get();

        // Local-only path: synchronous batch insert — no network, so one
        // single set with all of them.
        if (!client || !supportsSync) {
          const localBatch: ContactCard[] = contacts.map(c => ({
            ...c,
            id: `local-${generateUUID()}`,
          }));
          set((state) => ({ contacts: [...state.contacts, ...localBatch] }));
          return localBatch.length;
        }

        // Server-sync path: was N sequential `client.createContact()`
        // calls — importing a 200-contact vCard took 200 × RTT. Each
        // create is independent so fan-out + allSettled. Each success
        // appends to the contacts array, preserving the per-create
        // incremental UI update.
        const settled = await Promise.allSettled(contacts.map(async (contact) => {
          const { id: _id, ...data } = contact;
          const created = await client.createContact(data);
          set((state) => ({ contacts: [...state.contacts, created] }));
          return created;
        }));
        let imported = 0;
        for (const r of settled) {
          if (r.status === 'fulfilled') imported++;
          else console.error('Failed to import contact:', r.reason);
        }
        return imported;
      },
    });
    },
    {
      name: 'contact-storage',
      partialize: (state) => ({
        contacts: state.supportsSync ? [] : state.contacts,
        supportsSync: state.supportsSync,
      }),
    }
  )
);

export type { ContactName };
