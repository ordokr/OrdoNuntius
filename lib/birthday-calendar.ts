import type { ContactCard, CalendarEvent, Calendar, PartialDate, Timestamp } from '@/lib/jmap/types';
import { getContactDisplayName } from '@/stores/contact-store';
import { eachYearOfInterval, parseISO } from 'date-fns';
// Re-export the id/color constants so callers that imported them from this
// file keep working; the canonical source is the tiny no-deps module so
// calendar-store can pull just the id without dragging the generator in.
export { BIRTHDAY_CALENDAR_ID, BIRTHDAY_CALENDAR_COLOR } from '@/lib/birthday-calendar-id';
import { BIRTHDAY_CALENDAR_ID, BIRTHDAY_CALENDAR_COLOR } from '@/lib/birthday-calendar-id';

/**
 * Virtual calendar object for the contact birthday calendar.
 */
export function createBirthdayCalendar(name?: string, color?: string): Calendar {
  return {
    id: BIRTHDAY_CALENDAR_ID,
    name: name || 'Birthdays',
    description: null,
    color: color || BIRTHDAY_CALENDAR_COLOR,
    sortOrder: 999,
    isSubscribed: true,
    isVisible: true,
    isDefault: false,
    includeInAvailability: 'none',
    defaultAlertsWithTime: null,
    defaultAlertsWithoutTime: null,
    timeZone: null,
    shareWith: null,
    myRights: {
      mayReadFreeBusy: true,
      mayReadItems: true,
      mayWriteAll: false,
      mayWriteOwn: false,
      mayUpdatePrivate: false,
      mayRSVP: false,
      mayShare: false,
      mayDelete: false,
    },
  };
}

// Hoisted out of the per-anniversary hot path — parseBirthdayDate runs
// per anniversary per contact in generateBirthdayEvents.
const PARTIAL_BIRTHDAY_RE = /^--(\d{2})-(\d{2})$/;

/**
 * Extract month and day from an AnniversaryDate.
 * Returns null if the date cannot be parsed into month/day.
 */
function parseBirthdayDate(date: string | PartialDate | Timestamp): { month: number; day: number; year?: number } | null {
  if (typeof date === 'string') {
    // Could be ISO date string like "1990-05-15" or partial "--05-15"
    if (date.startsWith('--')) {
      // Partial date: --MM-DD
      const match = PARTIAL_BIRTHDAY_RE.exec(date);
      if (match) {
        return { month: parseInt(match[1], 10), day: parseInt(match[2], 10) };
      }
      return null;
    }
    try {
      const parsed = parseISO(date);
      if (!isNaN(parsed.getTime())) {
        return {
          month: parsed.getMonth() + 1,
          day: parsed.getDate(),
          year: parsed.getFullYear(),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  if ('utc' in date && date['@type'] === 'Timestamp') {
    // Timestamp type
    try {
      const parsed = parseISO(date.utc);
      if (!isNaN(parsed.getTime())) {
        return {
          month: parsed.getMonth() + 1,
          day: parsed.getDate(),
          year: parsed.getFullYear(),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  // PartialDate type
  const partial = date as PartialDate;
  if (partial.month && partial.day) {
    return {
      month: partial.month,
      day: partial.day,
      year: partial.year || undefined,
    };
  }

  return null;
}

/**
 * Generate virtual CalendarEvent objects from contacts that have birthday anniversaries.
 * Events are generated for each year in the given date range.
 */
export function generateBirthdayEvents(
  contacts: ContactCard[],
  rangeStart: string,
  rangeEnd: string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const start = parseISO(rangeStart);
  const end = parseISO(rangeEnd);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return events;
  }

  const years = eachYearOfInterval({ start, end });
  // Also include the end date's year if not already covered. Compare
  // against the last year in `years` directly — eachYearOfInterval
  // returns in ascending order, so .some() is the same as a tail check.
  const endYear = end.getFullYear();
  if (years.length === 0 || years[years.length - 1].getFullYear() !== endYear) {
    years.push(new Date(endYear, 0, 1));
  }

  for (const contact of contacts) {
    if (!contact.anniversaries) continue;

    // Lazy displayName per contact — was called per matching anniversary,
    // doing the same name-resolution walk multiple times when a contact
    // had more than one birth anniversary. Also defers the cost until we
    // know we have a parseable birth date to render.
    let displayName: string | undefined;

    // for...in over the anniversaries Record drops the tuples-array
    // allocation. Runs per contact in the birthday-scan pass — for 5000
    // contacts that's 5000 throwaway arrays.
    const anniversaries = contact.anniversaries;
    for (const key in anniversaries) {
      const anniversary = anniversaries[key];
      if (anniversary.kind !== 'birth') continue;

      const parsed = parseBirthdayDate(anniversary.date);
      if (!parsed) continue;

      if (displayName === undefined) displayName = getContactDisplayName(contact);
      if (!displayName) continue;

      for (const yearDate of years) {
        const year = yearDate.getFullYear();
        // Handle Feb 29 in non-leap years: JS silently rolls over to Mar 1,
        // but the ISO eventStart string would be invalid. Clamp to Feb 28.
        let occMonth = parsed.month;
        let occDay = parsed.day;
        const occurrenceDate = new Date(year, occMonth - 1, occDay);
        if (occurrenceDate.getMonth() !== occMonth - 1) {
          occurrenceDate.setDate(0); // last day of previous month
          occMonth = occurrenceDate.getMonth() + 1;
          occDay = occurrenceDate.getDate();
        }
        if (occurrenceDate < start || occurrenceDate > end) continue;

        const monthStr = String(occMonth).padStart(2, '0');
        const dayStr = String(occDay).padStart(2, '0');
        const eventStart = `${year}-${monthStr}-${dayStr}T00:00:00`;

        const age = parsed.year ? year - parsed.year : undefined;
        const ageText = age && age > 0 ? ` (${age})` : '';

        const event: CalendarEvent = {
          id: `birthday-${contact.id}-${key}-${year}`,
          calendarIds: { [BIRTHDAY_CALENDAR_ID]: true },
          isDraft: false,
          isOrigin: false,
          utcStart: null,
          utcEnd: null,
          '@type': 'Event',
          uid: `birthday-${contact.id}-${key}`,
          title: `🎂 ${displayName}${ageText}`,
          description: '',
          descriptionContentType: 'text/plain',
          created: null,
          updated: '',
          sequence: 0,
          start: eventStart,
          duration: 'P1D',
          timeZone: null,
          showWithoutTime: true,
          status: 'confirmed',
          freeBusyStatus: 'free',
          privacy: 'public',
          color: null,
          keywords: null,
          categories: null,
          locale: null,
          replyTo: null,
          organizerCalendarAddress: null,
          participants: null,
          mayInviteSelf: false,
          mayInviteOthers: false,
          hideAttendees: false,
          recurrenceId: null,
          recurrenceIdTimeZone: null,
          recurrenceRules: null,
          recurrenceOverrides: null,
          excludedRecurrenceRules: null,
          useDefaultAlerts: false,
          alerts: null,
          locations: null,
          virtualLocations: null,
          links: null,
          relatedTo: null,
        };

        events.push(event);
      }
    }
  }

  return events;
}
