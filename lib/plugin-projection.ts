// Projection helpers - convert host-internal types into the read-only views
// that plugins consume. Keeping this in one place ensures every slot/hook
// hands plugins the same shape declared in plugin-types.ts.

import type { Email } from '@/lib/jmap/types';
import type { EmailReadView } from '@/lib/plugin-types';

// Build a truthy-key list with one for...in walk. Was: `Object.keys(rec ||
// {}).filter(k => rec[k])` — allocates an empty-object fallback when rec is
// missing, a keys array, then a throwaway filtered array.
function truthyKeys(rec: Record<string, unknown> | undefined): string[] {
  if (!rec) return [];
  const out: string[] = [];
  for (const k in rec) if (rec[k]) out.push(k);
  return out;
}

function projectAddresses(
  list: { name?: string; email: string }[] | undefined,
): { name: string; email: string }[] {
  if (!list || list.length === 0) return [];
  const out: { name: string; email: string }[] = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    out[i] = { name: a.name || '', email: a.email };
  }
  return out;
}

export function emailToReadView(email: Email): EmailReadView {
  return {
    id: email.id,
    threadId: email.threadId,
    mailboxIds: truthyKeys(email.mailboxIds as Record<string, unknown> | undefined),
    from: projectAddresses(email.from),
    to: projectAddresses(email.to),
    cc: projectAddresses(email.cc),
    subject: email.subject || '',
    receivedAt: email.receivedAt,
    isRead: !!email.keywords?.['$seen'],
    isFlagged: !!email.keywords?.['$flagged'],
    hasAttachment: email.hasAttachment,
    preview: email.preview || '',
    keywords: truthyKeys(email.keywords as Record<string, unknown> | undefined),
    auth: email.authenticationResults,
  };
}
