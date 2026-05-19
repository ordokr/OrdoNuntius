import type { Identity } from '@/lib/jmap/types';

interface ReplyRecipient {
  email?: string | null;
  name?: string | null;
}

interface ReplyRecipients {
  to?: ReplyRecipient[];
  cc?: ReplyRecipient[];
  bcc?: ReplyRecipient[];
}

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeBaseEmailAddress(email: string): string {
  const normalized = normalizeEmailAddress(email);
  const atIndex = normalized.indexOf('@');

  if (atIndex <= 0) {
    return normalized;
  }

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const plusIndex = localPart.indexOf('+');

  return `${plusIndex >= 0 ? localPart.slice(0, plusIndex) : localPart}@${domain}`;
}

function domainOf(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : '';
}

export function findReplyIdentityId(
  identities: Identity[],
  recipients?: ReplyRecipients,
): string | null {
  if (identities.length === 0 || !recipients) {
    return null;
  }

  const receivedAddresses = [
    ...(recipients.to || []),
    ...(recipients.cc || []),
    ...(recipients.bcc || []),
  ]
    .map((recipient) => recipient.email?.trim())
    .filter((email): email is string => Boolean(email));

  if (receivedAddresses.length === 0) {
    return null;
  }

  const exactMatches = new Set(receivedAddresses.map(normalizeEmailAddress));
  const exactIdentity = identities.find((identity) => exactMatches.has(normalizeEmailAddress(identity.email)));
  if (exactIdentity) {
    return exactIdentity.id;
  }

  const baseMatches = new Set(receivedAddresses.map(normalizeBaseEmailAddress));
  const baseIdentity = identities.find((identity) => baseMatches.has(normalizeBaseEmailAddress(identity.email)));

  return baseIdentity?.id ?? null;
}

export interface ReplyFromResolution {
  /** Identity to use for JMAP `identityId` and the SMTP envelope MAIL FROM. */
  identityId: string;
  /**
   * Override for the outgoing `From:` header. Populated when the incoming
   * message was delivered to an address on a domain the user owns (by
   * identity) but that isn't itself a configured identity — typical
   * domain-catch-all deployments. When set, the composer should put this
   * address (and `overrideName`) in the message's From header while sending
   * through the chosen identity.
   */
  overrideEmail?: string;
  overrideName?: string;
}

/**
 * Pick the identity + optional header-From override for replying to a message.
 *
 * Decision order:
 *   1. If a recipient address exactly matches an identity, reply as that
 *      identity with no override.
 *   2. Else if a recipient matches an identity after stripping `+tag`
 *      sub-addressing, reply as that identity with no override.
 *   3. Else if a recipient address is on a domain that one of the identities
 *      uses, treat that recipient as a catch-all alias: return the matching
 *      identity + the recipient as a header-From override.
 *   4. Else return `null` (caller falls back to primary identity).
 */
export function resolveReplyFrom(
  identities: Identity[],
  recipients?: ReplyRecipients,
): ReplyFromResolution | null {
  if (identities.length === 0 || !recipients) {
    return null;
  }

  const received: { email: string; name: string | undefined }[] = [
    ...(recipients.to || []),
    ...(recipients.cc || []),
    ...(recipients.bcc || []),
  ].flatMap((r) => {
    const email = r.email?.trim();
    if (!email) return [];
    return [{ email, name: r.name?.trim() || undefined }];
  });

  if (received.length === 0) {
    return null;
  }

  // Index identities once. Previously walked `identities` 3× via `.map(...)`
  // to build Sets + did `.find(...)` over identities with nested `.some(...)`
  // over received (O(I × R) per find, twice). Now each per-identity
  // normalization happens exactly once, and lookups are O(1).
  const identityByEmail = new Map<string, Identity>();
  const identityByBase = new Map<string, Identity>();
  const identityByDomain = new Map<string, Identity>();
  for (const id of identities) {
    const norm = normalizeEmailAddress(id.email);
    const base = normalizeBaseEmailAddress(id.email);
    const domain = domainOf(id.email);
    if (!identityByEmail.has(norm)) identityByEmail.set(norm, id);
    if (!identityByBase.has(base)) identityByBase.set(base, id);
    if (domain && !identityByDomain.has(domain)) identityByDomain.set(domain, id);
  }

  for (const r of received) {
    const exact = identityByEmail.get(normalizeEmailAddress(r.email));
    if (exact) return { identityId: exact.id };
  }
  for (const r of received) {
    const base = identityByBase.get(normalizeBaseEmailAddress(r.email));
    if (base) return { identityId: base.id };
  }

  // Catch-all: a recipient on an owned domain that's NOT an exact/base
  // identity (so we'd reply *from* the domain's anchor identity but with
  // the recipient's address as override).
  for (const r of received) {
    const norm = normalizeEmailAddress(r.email);
    if (identityByEmail.has(norm) || identityByBase.has(normalizeBaseEmailAddress(norm))) continue;
    const domain = domainOf(norm);
    const anchor = identityByDomain.get(domain) || identities[0];
    if (identityByDomain.has(domain)) {
      return { identityId: anchor.id, overrideEmail: r.email, overrideName: r.name };
    }
  }

  return null;
}