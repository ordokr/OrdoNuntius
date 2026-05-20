/**
 * Lightweight TNEF detection split out of `lib/tnef.ts` (~13 KB source
 * containing the binary parser). email-viewer renders this filter on
 * every email open to decide whether to display the winmail.dat helper;
 * the full parser is only needed when the user actually has a TNEF
 * attachment and we choose to extract from it.
 */

/**
 * Check if a MIME attachment is a TNEF (winmail.dat) file.
 */
export function isTnefAttachment(name?: string | null, type?: string): boolean {
  const lowerName = (name || '').toLowerCase();
  const lowerType = (type || '').toLowerCase();
  return (
    lowerName === 'winmail.dat' ||
    lowerType === 'application/ms-tnef' ||
    lowerType === 'application/vnd.ms-tnef'
  );
}
