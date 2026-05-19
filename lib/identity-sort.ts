/**
 * Shared identity-sorting logic. Was duplicated:
 *   - `stores/auth-store.ts` (`emailMatchesUsername` + `sortIdentities` +
 *     promote-preferred logic inside `loadIdentities`)
 *   - `components/identity/identity-manager-modal.tsx`
 *     (`emailMatchesUsername` + inline sort in `refreshIdentities`)
 *
 * Both implementations had drift potential — the auth-store version
 * was authoritative (used at login) but the modal had its own copy
 * used after manual refresh. Any tweak to ordering rules would have
 * needed two edits.
 */

import type { Identity } from "@/lib/jmap/types";
import { localPart } from "@/lib/utils";

/**
 * Whether an identity's email "matches" the user's login. Handles both
 * forms: full "user@domain" usernames and local-part-only usernames
 * (some IMAP/JMAP servers accept either).
 */
export function emailMatchesUsername(email: string, username: string): boolean {
  if (email === username) return true;
  if (!username.includes('@') && localPart(email) === username) return true;
  return false;
}

/**
 * Sort identities so the user's canonical identity (matching username,
 * not mayDelete) sits first, with the optional `preferredPrimaryId`
 * trumping that when set. Doesn't mutate the input.
 *
 * Schwartzian: `emailMatchesUsername(...)` is called per identity once
 * (decorate) instead of per comparison (the raw comparator pattern
 * would call it 2N log N times across a sort).
 */
export function sortIdentities(
  rawIdentities: Identity[],
  username: string,
  preferredPrimaryId?: string | null,
): Identity[] {
  // Pre-sized decorated + indexed unwrap — drops two .map intermediates.
  const decorated: { id: Identity; matches: boolean }[] = new Array(rawIdentities.length);
  for (let i = 0; i < rawIdentities.length; i++) {
    decorated[i] = { id: rawIdentities[i], matches: emailMatchesUsername(rawIdentities[i].email, username) };
  }
  decorated.sort((a, b) => {
    if (a.matches !== b.matches) return a.matches ? -1 : 1;
    if (a.matches && b.matches) {
      if (a.id.mayDelete !== b.id.mayDelete) return a.id.mayDelete ? 1 : -1;
    }
    return 0;
  });
  const sorted: Identity[] = new Array(decorated.length);
  for (let i = 0; i < decorated.length; i++) sorted[i] = decorated[i].id;

  if (preferredPrimaryId) {
    const idx = sorted.findIndex(id => id.id === preferredPrimaryId);
    if (idx > 0) {
      const [preferred] = sorted.splice(idx, 1);
      sorted.unshift(preferred);
    }
  }

  return sorted;
}
