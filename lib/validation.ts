import { splitTrimmed } from './utils';

/**
 * RFC 5322 compliant email validation with security enhancements
 */
export function isValidEmail(email: string): boolean {
  // Length check
  if (!email || email.length > 254) return false;

  // Security: Block control characters and header injection
  if (/[\r\n\0<>]/.test(email)) return false;

  // RFC 5322 compliant regex (simplified but secure)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailRegex.test(email)) return false;

  // Additional checks. indexOf+slice avoids the throwaway 2-element array
  // that `.split('@')` allocates per call — this function runs per
  // recipient input in the composer (every keystroke).
  const at = email.indexOf('@');
  // emailRegex guarantees a single `@`; this is a safety check, not a parse.
  if (at === -1) return false;
  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1);

  // Local part max 64 chars
  if (localPart.length > 64) return false;

  // Domain validation
  if (domain.length > 255) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;

  return true;
}

/**
 * Validate comma-separated email list
 * @returns Object with validation result and invalid emails
 */
export function validateEmailList(csv: string): {
  valid: boolean;
  invalidEmails: string[];
} {
  if (!csv?.trim()) {
    return { valid: true, invalidEmails: [] };
  }

  const emails = splitTrimmed(csv);
  const invalid = emails.filter(e => !isValidEmail(e));

  return {
    valid: invalid.length === 0,
    invalidEmails: invalid
  };
}

/**
 * Validation error codes returned by `getEmailValidationErrorCode`.
 * Callers translate these via the `validation_errors` namespace; this
 * module stays as a pure utility that doesn't pull next-intl in.
 */
export type EmailValidationErrorCode =
  | 'EMAIL_REQUIRED'
  | 'EMAIL_TOO_LONG'
  | 'EMAIL_INVALID_CHARS'
  | 'EMAIL_INVALID'
  | null;

/**
 * Returns an error code (or null) for an email address. Translation
 * happens at the call site — see `validation_errors` in locale JSON.
 */
export function getEmailValidationErrorCode(email: string): EmailValidationErrorCode {
  if (!email?.trim()) return 'EMAIL_REQUIRED';
  if (email.length > 254) return 'EMAIL_TOO_LONG';
  if (/[\r\n\0<>]/.test(email)) return 'EMAIL_INVALID_CHARS';
  if (!isValidEmail(email)) return 'EMAIL_INVALID';
  return null;
}

/**
 * Get user-friendly validation error message.
 *
 * @deprecated Use `getEmailValidationErrorCode` and translate at the
 * call site. Kept for back-compat with existing callers; returns the
 * English string corresponding to the code so behavior is unchanged
 * for any caller that hasn't migrated.
 */
export function getEmailValidationError(email: string): string | null {
  const code = getEmailValidationErrorCode(email);
  if (!code) return null;
  switch (code) {
    case 'EMAIL_REQUIRED': return 'Email address is required';
    case 'EMAIL_TOO_LONG': return 'Email address is too long (max 254 characters)';
    case 'EMAIL_INVALID_CHARS': return 'Email address contains invalid characters';
    case 'EMAIL_INVALID': return 'Please enter a valid email address';
  }
}

/**
 * Validate unsubscribe URL (RFC 2369 List-Unsubscribe)
 * Only allows safe protocols: http, https, mailto
 * @param url - URL to validate
 * @returns true if URL is safe to use
 */
export function isValidUnsubscribeUrl(url: string): boolean {
  if (!url?.trim()) return false;

  if (url.startsWith('mailto:')) {
    const email = url.substring(7);
    const emailPart = email.split('?')[0];
    return isValidEmail(emailPart);
  }

  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Parse List-Unsubscribe header and extract all valid URLs
 * RFC 2369 allows multiple comma-separated URLs in <url> format
 * @param header - Raw List-Unsubscribe header value
 * @returns Object with http and mailto URLs, plus preferred method
 */
export function parseUnsubscribeUrls(header: string): {
  http?: string;
  mailto?: string;
  preferred?: 'http' | 'mailto';
} {
  if (!header?.trim()) return {};

  const matches = header.match(/<([^>]+)>/g);
  if (!matches) return {};

  const urls = matches.map(m => m.slice(1, -1).trim());

  const http = urls.find(u =>
    (u.startsWith('http://') || u.startsWith('https://')) &&
    isValidUnsubscribeUrl(u)
  );
  const mailto = urls.find(u =>
    u.startsWith('mailto:') &&
    isValidUnsubscribeUrl(u)
  );

  const preferred = http ? 'http' : (mailto ? 'mailto' : undefined);

  return { http, mailto, preferred };
}
