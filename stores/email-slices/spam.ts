/**
 * Spam-handling slice of `useEmailStore`. Stage 3 of the slice-split
 * refactor (after `unified.ts` + `thread.ts`). Owns one state field
 * (`spamUndoCache`) and four actions:
 *   - `markAsSpam` / `undoSpam` (single-email)
 *   - `batchMarkAsSpam` / `batchUndoSpam` (multi-email)
 *
 * `spamUndoCache` maps `emailId -> { originalMailboxId, accountId }` so
 * the toast undo can restore an email to where it came from (which the
 * server doesn't remember once it moves to Spam). Batch undo doesn't
 * use the cache — it falls back to Inbox because re-spamming a batch
 * isn't an "undo the previous action" gesture, it's a recovery action.
 *
 * The slice writes cross-slice fields (`emails`, `selectedEmail`,
 * `selectedEmailIds`) and reads cross-slice fields (`mailboxes`,
 * `selectedMailbox`, `emails`, `selectedEmail`). It also calls the core
 * `fetchEmails` action to re-sync after `undoSpam` because the JMAP
 * mutation isn't reflected in our local list until the next fetch.
 */

import { type StateCreator } from "zustand";
import type { Email, Mailbox } from "@/lib/jmap/types";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { getNextSelectedEmail } from "./_helpers";

interface SpamUndoEntry {
  emailId: string;
  originalMailboxId: string;
  accountId?: string;
}

export interface SpamSlice {
  spamUndoCache: Map<string, SpamUndoEntry>;
  markAsSpam: (client: IJMAPClient, emailId: string) => Promise<void>;
  undoSpam: (client: IJMAPClient, emailId: string) => Promise<void>;
  batchMarkAsSpam: (client: IJMAPClient, emailIds: string[]) => Promise<void>;
  batchUndoSpam: (client: IJMAPClient, emailIds: string[]) => Promise<void>;
}

export const createSpamSlice: StateCreator<
  SpamSlice & {
    selectedMailbox: string;
    mailboxes: Mailbox[];
    emails: Email[];
    selectedEmail: Email | null;
    selectedEmailIds: Set<string>;
    fetchEmails: (client: IJMAPClient, mailboxId?: string) => Promise<void>;
  },
  [],
  [],
  SpamSlice
> = (set, get) => ({
  spamUndoCache: new Map(),

  markAsSpam: async (client, emailId) => {
    const { selectedMailbox, mailboxes, emails } = get();
    const email = emails.find(e => e.id === emailId);
    if (!email) return;

    const currentMailbox = mailboxes.find(m => m.id === selectedMailbox);
    if (!currentMailbox) return;

    // Stash the original location BEFORE the server call so a fast
    // toast-undo from the user has somewhere to restore from. Immutable
    // copy: in-place `state.spamUndoCache.set(...)` would bypass the
    // zustand setter and dev-tools / subscribers wouldn't see the change.
    set(state => {
      const next = new Map(state.spamUndoCache);
      next.set(emailId, {
        emailId,
        originalMailboxId: currentMailbox.originalId || currentMailbox.id,
        accountId: currentMailbox.accountId,
      });
      return { spamUndoCache: next };
    });

    try {
      await client.markAsSpam(emailId, currentMailbox.accountId);
      set(state => ({
        emails: state.emails.filter(e => e.id !== emailId),
        selectedEmail: getNextSelectedEmail(state, emailId),
      }));
    } catch (error) {
      console.error('Failed to mark as spam:', error);
      throw error;
    }
  },

  undoSpam: async (client, emailId) => {
    const { mailboxes, selectedMailbox } = get();
    const cached = get().spamUndoCache.get(emailId);

    let targetMailboxId: string;
    let accountId: string | undefined;

    if (cached) {
      // Toast-undo path: restore to the exact mailbox the email came from.
      targetMailboxId = cached.originalMailboxId;
      accountId = cached.accountId;
      set(state => {
        const next = new Map(state.spamUndoCache);
        next.delete(emailId);
        return { spamUndoCache: next };
      });
    } else {
      // Generic "not spam" gesture from the spam folder: no original
      // mailbox known, fall back to inbox in the same account.
      const currentMailbox = mailboxes.find(m => m.id === selectedMailbox);
      accountId = currentMailbox?.accountId;

      const inboxMailbox = mailboxes.find(m =>
        m.role === 'inbox' &&
        (accountId ? m.accountId === accountId : !m.accountId)
      );
      if (!inboxMailbox) throw new Error('Inbox not found');
      targetMailboxId = inboxMailbox.originalId || inboxMailbox.id;
    }

    try {
      await client.undoSpam(emailId, targetMailboxId, accountId);
      await get().fetchEmails(client, selectedMailbox);
    } catch (error) {
      console.error('Failed to restore email:', error);
      throw error;
    }
  },

  batchMarkAsSpam: async (client, emailIds) => {
    const { selectedMailbox, mailboxes } = get();
    const currentMailbox = mailboxes.find(m => m.id === selectedMailbox);
    if (!currentMailbox) return;

    try {
      for (const emailId of emailIds) {
        await client.markAsSpam(emailId, currentMailbox.accountId);
      }
      set(state => ({
        emails: state.emails.filter(e => !emailIds.includes(e.id)),
        selectedEmail: emailIds.includes(state.selectedEmail?.id || '') ? null : state.selectedEmail,
        selectedEmailIds: new Set(),
      }));
    } catch (error) {
      console.error('Failed to batch mark as spam:', error);
      throw error;
    }
  },

  batchUndoSpam: async (client, emailIds) => {
    const { mailboxes, selectedMailbox } = get();
    const currentMailbox = mailboxes.find(m => m.id === selectedMailbox);
    const accountId = currentMailbox?.accountId;

    const inboxMailbox = mailboxes.find(m =>
      m.role === 'inbox' &&
      (accountId ? m.accountId === accountId : !m.accountId)
    );
    if (!inboxMailbox) throw new Error('Inbox not found');

    try {
      for (const emailId of emailIds) {
        await client.undoSpam(emailId, inboxMailbox.originalId || inboxMailbox.id, accountId);
      }
      set(state => ({
        emails: state.emails.filter(e => !emailIds.includes(e.id)),
        selectedEmail: emailIds.includes(state.selectedEmail?.id || '') ? null : state.selectedEmail,
        selectedEmailIds: new Set(),
      }));
    } catch (error) {
      console.error('Failed to batch restore emails:', error);
      throw error;
    }
  },
});
