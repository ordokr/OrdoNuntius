/**
 * Sub-addressing utilities for user{delimiter}tag@domain.com format
 * Works server-side automatically - no JMAP API calls needed
 *
 * The delimiter character is configurable per server (RFC 5233). Common
 * choices: "+" (Postfix, Stalwart default), "-" (qmail), ".", "=".
 */

// Constants for tag validation
const MAX_TAG_LENGTH = 30;
const TAG_REGEX = /^[a-zA-Z0-9-]{1,30}$/;
// Module-scope — was a per-call `new RegExp` allocation inside getTagValidationError.
const TAG_CHARS_REGEX = /^[a-zA-Z0-9-]+$/;
// Module-scope — was allocated as a literal /[^a-zA-Z0-9-]/g inside generateSubAddress.
const TAG_SANITIZE_REGEX = /[^a-zA-Z0-9-]/g;

// Delimiter primitives moved to lib/sub-address-delimiter.ts so settings-store
// can pull them without dragging the full parse/generate machinery below.
// Re-exported here so existing consumers keep working unchanged.
import {
  DEFAULT_SUB_ADDRESS_DELIMITER,
  SUPPORTED_SUB_ADDRESS_DELIMITERS,
  isSupportedSubAddressDelimiter,
  isValidSubAddressDelimiter,
} from './sub-address-delimiter';
export {
  DEFAULT_SUB_ADDRESS_DELIMITER,
  SUPPORTED_SUB_ADDRESS_DELIMITERS,
  isSupportedSubAddressDelimiter,
  isValidSubAddressDelimiter,
};
export type { SubAddressDelimiterPreset } from './sub-address-delimiter';

export type TagValidationErrorCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INVALID_CHARS'
  | null;

export interface ParsedAddress {
  localPart: string;
  baseUser: string;
  tag: string | null;
  domain: string;
  fullAddress: string;
}

/**
 * Parse an email address to extract sub-address tag.
 * The first occurrence of the delimiter in the local part separates the
 * base user from the tag, matching the behavior of Postfix/qmail/Sieve.
 */
export function parseSubAddress(
  email: string,
  delimiter: string = DEFAULT_SUB_ADDRESS_DELIMITER,
): ParsedAddress {
  // Avoid `email.split('@')` — allocates a 2-element array every call. With
  // sub-address parsing happening per email row + per recipient, the
  // throwaway arrays add up. `indexOf` + `slice` does the same work with
  // no array allocation. Mirrors split('@') semantics when '@' is absent:
  // localPart = the whole string, domain = ''.
  const atIdx = email.indexOf('@');
  const localPart = atIdx === -1 ? email : email.slice(0, atIdx);
  const domain = atIdx === -1 ? '' : email.slice(atIdx + 1);

  if (!localPart || !domain) {
    return {
      localPart: localPart || '',
      baseUser: localPart || '',
      tag: null,
      domain: domain || '',
      fullAddress: email,
    };
  }

  const delimiterIndex = localPart.indexOf(delimiter);

  if (delimiterIndex === -1) {
    return {
      localPart,
      baseUser: localPart,
      tag: null,
      domain,
      fullAddress: email,
    };
  }

  const baseUser = localPart.substring(0, delimiterIndex);
  const tag = localPart.substring(delimiterIndex + delimiter.length);

  return {
    localPart,
    baseUser,
    tag: tag || null,
    domain,
    fullAddress: email,
  };
}

/**
 * Generate a sub-addressed email.
 * Example: generateSubAddress("user@example.com", "shopping", "+") -> "user+shopping@example.com"
 */
export function generateSubAddress(
  baseEmail: string,
  tag: string,
  delimiter: string = DEFAULT_SUB_ADDRESS_DELIMITER,
): string {
  const atIdx = baseEmail.indexOf('@');
  if (atIdx === -1) return baseEmail;
  const localPart = baseEmail.slice(0, atIdx);
  const domain = baseEmail.slice(atIdx + 1);

  if (!localPart || !domain || !tag) {
    return baseEmail;
  }

  // Strip an existing tag if one is already present
  const existingDelimiterIndex = localPart.indexOf(delimiter);
  const cleanLocal = existingDelimiterIndex === -1
    ? localPart
    : localPart.substring(0, existingDelimiterIndex);

  // Sanitize tag (alphanumeric and dash only)
  const cleanTag = tag.replace(TAG_SANITIZE_REGEX, '').toLowerCase();

  if (!cleanTag) {
    return baseEmail;
  }

  return `${cleanLocal}${delimiter}${cleanTag}@${domain}`;
}

/**
 * Extract domain from recipient email for tag suggestions
 */
export function extractDomain(email: string): string | null {
  // lastIndexOf + slice avoids the per-call RegExp.exec allocation that
  // `email.match(/@([^@]+)$/)` does — and there is at most one `@` in any
  // RFC-compliant address, so the simpler walk gives the same result.
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

// Module-scope lookup — was being rebuilt as a 19-entry object literal on every call.
const DOMAIN_TAG_SUGGESTIONS: Record<string, string[]> = {
  'amazon.com': ['amazon', 'shopping', 'orders'],
  'amazon.fr': ['amazon', 'shopping', 'orders'],
  'amazon.de': ['amazon', 'shopping', 'orders'],
  'amazon.co.uk': ['amazon', 'shopping', 'orders'],
  'ebay.com': ['ebay', 'shopping'],
  'ebay.fr': ['ebay', 'shopping'],
  'paypal.com': ['paypal', 'payments'],
  'facebook.com': ['facebook', 'social'],
  'twitter.com': ['twitter', 'social'],
  'x.com': ['twitter', 'social'],
  'linkedin.com': ['linkedin', 'professional'],
  'github.com': ['github', 'dev', 'notifications'],
  'gitlab.com': ['gitlab', 'dev', 'notifications'],
  'stackoverflow.com': ['stackoverflow', 'dev'],
  'reddit.com': ['reddit', 'social'],
  'netflix.com': ['netflix', 'entertainment'],
  'spotify.com': ['spotify', 'music'],
  'steam.com': ['steam', 'gaming'],
  'discord.com': ['discord', 'gaming'],
};

/**
 * Suggest tags based on recipient domain
 */
export function suggestTagsForDomain(domain: string): string[] {
  const domainLower = domain.toLowerCase();

  // Check for exact domain match
  const direct = DOMAIN_TAG_SUGGESTIONS[domainLower];
  if (direct) return direct;

  // Extract main domain (e.g., "mail.google.com" -> "google") without split allocation.
  const lastDot = domainLower.lastIndexOf('.');
  let mainDomain: string;
  if (lastDot === -1) {
    mainDomain = domainLower;
  } else {
    const prevDot = domainLower.lastIndexOf('.', lastDot - 1);
    mainDomain = prevDot === -1 ? domainLower.slice(0, lastDot) : domainLower.slice(prevDot + 1, lastDot);
  }

  // Generic suggestions based on domain name
  return [mainDomain, 'newsletter', 'registration'];
}

/**
 * Validate if a tag is safe to use
 */
export function isValidTag(tag: string): boolean {
  return TAG_REGEX.test(tag);
}

/**
 * Get validation error code for an invalid tag
 * Returns an error code that should be translated by the calling component
 */
export function getTagValidationError(tag: string): TagValidationErrorCode {
  if (!tag) {
    return 'EMPTY';
  }

  if (tag.length > MAX_TAG_LENGTH) {
    return 'TOO_LONG';
  }

  if (!TAG_CHARS_REGEX.test(tag)) {
    return 'INVALID_CHARS';
  }

  return null;
}

// Export MAX_TAG_LENGTH for use in translations
export { MAX_TAG_LENGTH };
