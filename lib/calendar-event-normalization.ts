import { parseISO } from 'date-fns';
import type { CalendarEvent } from '@/lib/jmap/types';

const DURATION_RE = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
// Hoisted out of the per-event hot path — these were re-created on every
// isMidnightValue call (hundreds per month-view load).
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PORTION_RE = /T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

function isDateOnlyValue(value: string): boolean {
  return DATE_ONLY_RE.test(value);
}

function isMidnightValue(value: string): boolean {
  if (isDateOnlyValue(value)) {
    return true;
  }

  const match = TIME_PORTION_RE.exec(value);
  if (!match) {
    return false;
  }

  return match[1] === '00' && match[2] === '00' && (match[3] ?? '00') === '00';
}

function parseDurationSeconds(duration: string | undefined): number | null {
  if (!duration) {
    return null;
  }

  const match = DURATION_RE.exec(duration);
  if (!match) {
    return null;
  }

  const weeks = parseInt(match[1] || '0', 10);
  const days = parseInt(match[2] || '0', 10);
  const hours = parseInt(match[3] || '0', 10);
  const minutes = parseInt(match[4] || '0', 10);
  const seconds = parseInt(match[5] || '0', 10);

  return (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds;
}

export function normalizeAllDayDurationValue(duration: string | undefined): string | undefined {
  const totalSeconds = parseDurationSeconds(duration);
  if (totalSeconds === null || totalSeconds < 86400 || totalSeconds % 86400 !== 0) {
    return duration;
  }

  return `P${totalSeconds / 86400}D`;
}

export function isAllDayEventLike(event: Pick<Partial<CalendarEvent>, 'start' | 'duration' | 'showWithoutTime'>): boolean {
  if (event.showWithoutTime) {
    return true;
  }

  if (!event.start || !event.duration || !isMidnightValue(event.start)) {
    return false;
  }

  const totalSeconds = parseDurationSeconds(event.duration);
  if (totalSeconds === null || totalSeconds < 86400 || totalSeconds % 86400 !== 0) {
    return false;
  }

  const start = parseISO(event.start);
  if (Number.isNaN(start.getTime())) {
    return false;
  }

  const end = new Date(start.getTime() + totalSeconds * 1000);
  return end.getHours() === 0
    && end.getMinutes() === 0
    && end.getSeconds() === 0
    && end.getMilliseconds() === 0;
}

/**
 * Stalwart returns "recurrenceRule" (singular) instead of RFC 8984 "recurrenceRules" (plural).
 * Normalize server responses to match the client's internal type.
 */
function normalizeStalwartPropertyNames<T extends Partial<CalendarEvent>>(event: T): T {
  const raw = event as Record<string, unknown>;
  // Fast path: most events (Stalwart-normalized or no recurrence at all)
  // hit neither branch. Skip the `updates` literal allocation in that case.
  const hasSingularRule = 'recurrenceRule' in raw && !('recurrenceRules' in raw);
  const hasSingularExcluded = 'excludedRecurrenceRule' in raw && !('excludedRecurrenceRules' in raw);
  if (!hasSingularRule && !hasSingularExcluded) return event;

  const updates: Partial<CalendarEvent> = {};

  if (hasSingularRule) {
    // JSCalendar 2.0 (jscalendarbis-15) defines recurrenceRule as a single object,
    // but Stalwart may also return it as an array (for JMAP-created events).
    // Normalize both forms to our internal array type.
    const val = raw.recurrenceRule;
    if (val != null && !Array.isArray(val) && typeof val === 'object') {
      updates.recurrenceRules = [val] as CalendarEvent['recurrenceRules'];
    } else {
      updates.recurrenceRules = val as CalendarEvent['recurrenceRules'];
    }
  }
  if (hasSingularExcluded) {
    const val = raw.excludedRecurrenceRule;
    if (val != null && !Array.isArray(val) && typeof val === 'object') {
      updates.excludedRecurrenceRules = [val] as CalendarEvent['excludedRecurrenceRules'];
    } else {
      updates.excludedRecurrenceRules = val as CalendarEvent['excludedRecurrenceRules'];
    }
  }

  const result = { ...event, ...updates } as T;
  // Set to undefined instead of `delete` — JSON.stringify omits undefined
  // values, downstream consumers only read the plural (already in `updates`),
  // and `delete` would transition the object to V8 dictionary mode for the
  // rest of its lifetime. Runs per event in normalized calendar responses.
  (result as Record<string, unknown>).recurrenceRule = undefined;
  (result as Record<string, unknown>).excludedRecurrenceRule = undefined;
  return result;
}

export function normalizeCalendarEventLike<T extends Partial<CalendarEvent>>(event: T): T {
  // First normalize Stalwart's singular property names to RFC 8984 plural forms
  const normalized = normalizeStalwartPropertyNames(event);

  // Fast path: events with showWithoutTime already set need at most a
  // duration touch-up. Was: rebuild via {...normalized, showWithoutTime: true,
  // duration: ...} on every per-event normalize — allocating a new object
  // per event in the query response (hundreds per month view load) even
  // when the spread literally added nothing new.
  if (normalized.showWithoutTime) {
    const fixedDuration = normalizeAllDayDurationValue(normalized.duration);
    if (fixedDuration === normalized.duration) return normalized;
    return { ...normalized, duration: fixedDuration } as T;
  }

  if (!isAllDayEventLike(normalized)) {
    return normalized;
  }

  return {
    ...normalized,
    showWithoutTime: true,
    duration: normalizeAllDayDurationValue(normalized.duration),
  } as T;
}

export function sanitizeOutgoingCalendarEventData<T extends Partial<CalendarEvent>>(event: T): T {
  const normalized = normalizeCalendarEventLike(event);
  if (!normalized.showWithoutTime) {
    return normalized;
  }

  const normalizedStart = normalized.start
    ? `${normalized.start.slice(0, 10)}T00:00:00`
    : normalized.start;

  return {
    ...normalized,
    start: normalizedStart,
    duration: normalizeAllDayDurationValue(normalized.duration),
    timeZone: null,
  } as T;
}