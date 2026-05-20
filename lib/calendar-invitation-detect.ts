// Cheap iCal/iMIP detection helpers, split out of lib/calendar-invitation.ts.
//
// email-viewer is the only consumer of `findCalendarAttachment` and
// `isCalendarMimeType` on the cold inbox path. The full
// calendar-invitation.ts module is ~628 lines and statically imports
// normalizeCalendarEventLike from calendar-event-normalization (plus
// date-fns + jmap/types + lib/utils), so importing it eagerly drags the
// entire iMIP processing pipeline into the email-viewer chunk even
// though the viewer only needs the two detectors below to decide
// whether to mount the (already-dynamic) CalendarInvitationBanner.
//
// This module is intentionally dependency-light: just string and shape
// checks. Keeping it that way preserves the cold-path win.

import type { Email, Attachment, EmailBodyPart } from '@/lib/jmap/types';

function extractMimeType(value?: string | null): string {
  if (!value) return '';
  const semi = value.indexOf(';');
  const head = semi === -1 ? value : value.slice(0, semi);
  return head.trim().toLowerCase();
}

export function isCalendarMimeType(value?: string | null): boolean {
  const mimeType = extractMimeType(value);
  return mimeType === 'text/calendar' || mimeType === 'application/ics' || mimeType === 'application/icalendar';
}

export function findCalendarBodyPart(parts?: EmailBodyPart[]): Attachment | null {
  if (!parts) return null;

  for (const part of parts) {
    if (isCalendarMimeType(part.type) || part.name?.toLowerCase().endsWith('.ics') || part.name?.toLowerCase().endsWith('.ical')) {
      return {
        partId: part.partId,
        blobId: part.blobId,
        size: part.size,
        name: part.name || 'invite.ics',
        type: part.type,
        charset: part.charset,
        disposition: part.disposition,
        cid: part.cid,
      };
    }

    const nested = findCalendarBodyPart(part.subParts);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function findCalendarAttachment(email: Email): Attachment | null {
  if (email.attachments) {
    for (const att of email.attachments) {
      if (
        isCalendarMimeType(att.type) ||
        att.name?.toLowerCase().endsWith('.ics') ||
        att.name?.toLowerCase().endsWith('.ical')
      ) {
        return att;
      }
    }
  }

  const inlineAttachment = findCalendarBodyPart(email.textBody) || findCalendarBodyPart(email.htmlBody);
  if (inlineAttachment) return inlineAttachment;

  return null;
}
