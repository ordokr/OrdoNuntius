// Delimiter primitives split off lib/sub-addressing.ts so settings-store
// — which is loaded eagerly on every authenticated route through the
// app shell — can validate the configured delimiter without pulling the
// rest of the sub-addressing module (parseSubAddress, generateSubAddress,
// tag validation, RFC 5321 atext helpers) into the cold-load. Those are
// only needed by the email-composer (already dynamic) and sub-address-helper
// (mounted inside the composer chunk).

export const DEFAULT_SUB_ADDRESS_DELIMITER = '+';
export const SUPPORTED_SUB_ADDRESS_DELIMITERS = ['+', '-', '.', '='] as const;
export type SubAddressDelimiterPreset = (typeof SUPPORTED_SUB_ADDRESS_DELIMITERS)[number];

// Set-backed membership — O(1) vs O(n) Array.includes.
const SUPPORTED_DELIMITER_SET = new Set<string>(SUPPORTED_SUB_ADDRESS_DELIMITERS);

export function isSupportedSubAddressDelimiter(value: string): value is SubAddressDelimiterPreset {
  return SUPPORTED_DELIMITER_SET.has(value);
}

// RFC 5321 atext "special" characters, minus alphanumerics and "@". A custom
// delimiter must be exactly one of these — they're safe to embed in a local
// part and unambiguously separate the user from the tag.
const VALID_DELIMITER_REGEX = /^[!#$%&'*+\-./=?^_`{|}~]$/;

export function isValidSubAddressDelimiter(value: unknown): value is string {
  return typeof value === 'string' && VALID_DELIMITER_REGEX.test(value);
}
