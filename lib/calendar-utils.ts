import { addDays, differenceInCalendarDays, parseISO, startOfDay, subMilliseconds } from "date-fns";
import { parseDuration } from "@/components/calendar/event-card";
import type { CalendarEvent } from "@/lib/jmap/types";

export interface CalendarWeekSegment {
  event: CalendarEvent;
  startIndex: number;
  span: number;
  row: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface TimedEventLayout {
  event: CalendarEvent;
  column: number;
  totalColumns: number;
  startMinutes: number;
  endMinutes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function getEventStartDate(
  event: Pick<CalendarEvent, 'start' | 'utcStart' | 'showWithoutTime'>,
): Date {
  const source = !event.showWithoutTime && event.utcStart ? event.utcStart : event.start;
  return parseISO(source);
}

export function packWeekSegments(rawSegments: CalendarWeekSegment[]): CalendarWeekSegment[] {
  // Schwartzian: the comparator's tie-breaker is
  // `getEventStartDate(s.event).getTime()` which does a `parseISO` per
  // call. Pre-compute startMs per segment so each is parsed exactly
  // once, regardless of how often the comparator runs.
  const decorated = rawSegments.map(segment => ({
    segment,
    startMs: getEventStartDate(segment.event).getTime(),
  }));
  decorated.sort((left, right) => {
    if (left.segment.startIndex !== right.segment.startIndex) return left.segment.startIndex - right.segment.startIndex;
    if (left.segment.span !== right.segment.span) return right.segment.span - left.segment.span;
    if (left.segment.event.showWithoutTime !== right.segment.event.showWithoutTime) {
      return left.segment.event.showWithoutTime ? -1 : 1;
    }
    if (left.startMs !== right.startMs) return left.startMs - right.startMs;
    return (left.segment.event.title || "").localeCompare(right.segment.event.title || "");
  });

  // Pre-sized output replaces `decorated.map(...)`. findIndex is a manual
  // for-loop too so we drop both the .map allocation and the .findIndex
  // closure cost per segment.
  const rowEndIndices: number[] = [];
  const out: CalendarWeekSegment[] = new Array(decorated.length);
  for (let i = 0; i < decorated.length; i++) {
    const segment = decorated[i].segment;
    const segmentEndIndex = segment.startIndex + segment.span - 1;
    let row = -1;
    for (let r = 0; r < rowEndIndices.length; r++) {
      if (rowEndIndices[r] < segment.startIndex) { row = r; break; }
    }
    if (row === -1) {
      row = rowEndIndices.length;
      rowEndIndices.push(segmentEndIndex);
    } else {
      rowEndIndices[row] = segmentEndIndex;
    }
    out[i] = { ...segment, row };
  }
  return out;
}

export function getEventEndDate(event: CalendarEvent): Date {
  if (!event.showWithoutTime && event.utcEnd) {
    return parseISO(event.utcEnd);
  }

  const start = getEventStartDate(event);
  if (!event.duration) return start;
  return new Date(start.getTime() + parseDuration(event.duration) * 60000);
}

export function getEventDisplayEndDate(event: CalendarEvent): Date {
  // Was: getEventEndDate(event) (1-2 parseISO inside) + getEventStartDate
  // (another parseISO). Inline the end computation so we compute start
  // exactly once and reuse it for both the duration-end fallback AND
  // the all-day clip comparison. Drops 1-2 parseISO per call.
  const start = getEventStartDate(event);
  let end: Date;
  if (!event.showWithoutTime && event.utcEnd) {
    end = parseISO(event.utcEnd);
  } else if (event.duration) {
    end = new Date(start.getTime() + parseDuration(event.duration) * 60000);
  } else {
    end = start;
  }
  if (!event.showWithoutTime || end.getTime() <= start.getTime()) return end;
  return subMilliseconds(end, 1);
}

export function getEventDayBounds(event: CalendarEvent): { startDay: Date; endDay: Date } {
  // Compute start once and thread it through end computation. The
  // straight composition `startOfDay(getEventStartDate)` +
  // `startOfDay(getEventDisplayEndDate)` would invoke
  // getEventStartDate THREE times (once directly, twice via
  // getEventDisplayEndDate → getEventEndDate + the disp-end check),
  // each doing a parseISO. This single-parse path is called per event
  // in every calendar render (buildWeekSegments, eventsByDate map,
  // mini-calendar dotted dates, etc.).
  const start = getEventStartDate(event);
  let end: Date;
  if (!event.showWithoutTime && event.utcEnd) {
    end = parseISO(event.utcEnd);
  } else if (event.duration) {
    end = new Date(start.getTime() + parseDuration(event.duration) * 60000);
  } else {
    end = start;
  }
  const displayEnd = (event.showWithoutTime && end.getTime() > start.getTime())
    ? subMilliseconds(end, 1)
    : end;
  return { startDay: startOfDay(start), endDay: startOfDay(displayEnd) };
}

export function getTimedEventBoundsForDay(
  event: CalendarEvent,
  day: Date,
): { startMinutes: number; endMinutes: number; continuesBefore: boolean; continuesAfter: boolean } | null {
  if (event.showWithoutTime) return null;

  const eventStart = getEventStartDate(event);
  const eventEnd = getEventEndDate(event);
  const dayStart = startOfDay(day);
  const nextDayStart = addDays(dayStart, 1);

  if (eventEnd <= dayStart || eventStart >= nextDayStart) {
    return null;
  }

  const clippedStart = eventStart > dayStart ? eventStart : dayStart;
  const clippedEnd = eventEnd < nextDayStart ? eventEnd : nextDayStart;
  const startMinutes = Math.max(0, Math.floor((clippedStart.getTime() - dayStart.getTime()) / 60000));
  const endMinutes = Math.min(1440, Math.ceil((clippedEnd.getTime() - dayStart.getTime()) / 60000));

  return {
    startMinutes,
    endMinutes,
    continuesBefore: eventStart < dayStart,
    continuesAfter: eventEnd > nextDayStart,
  };
}

export function isTimedEventFullDayOnDate(event: CalendarEvent, day: Date): boolean {
  const bounds = getTimedEventBoundsForDay(event, day);
  return bounds?.startMinutes === 0 && bounds?.endMinutes === 1440;
}

export function normalizeAllDayDuration(duration: string | undefined): string | undefined {
  if (!duration) return undefined;
  const totalMinutes = parseDuration(duration);
  const totalDays = Math.max(1, Math.ceil(totalMinutes / (24 * 60)));
  return `P${totalDays}D`;
}

export function buildAllDayDuration(start: Date, inclusiveEnd: Date): string {
  const dayCount = Math.max(1, differenceInCalendarDays(startOfDay(inclusiveEnd), startOfDay(start)) + 1);
  return `P${dayCount}D`;
}

export function buildWeekSegmentsRaw(events: CalendarEvent[], weekDays: Date[]): CalendarWeekSegment[] {
  if (weekDays.length === 0) return [];

  const weekStart = startOfDay(weekDays[0]);
  const weekEnd = startOfDay(weekDays[weekDays.length - 1]);

  // Direct loop + push. Was `.flatMap` returning `[]` or `[seg]` per
  // event, which allocates a throwaway per-event array of size 0 or 1
  // and a top-level array for the flatMap. For a month with 100+ events
  // × 6 weeks that's hundreds of empty arrays per render.
  const segments: CalendarWeekSegment[] = [];
  for (const event of events) {
    const { startDay, endDay } = getEventDayBounds(event);
    if (endDay < weekStart || startDay > weekEnd) continue;

    const segmentStart = startDay < weekStart ? weekStart : startDay;
    const segmentEnd = endDay > weekEnd ? weekEnd : endDay;
    segments.push({
      event,
      startIndex: differenceInCalendarDays(segmentStart, weekStart),
      span: differenceInCalendarDays(segmentEnd, segmentStart) + 1,
      row: -1,
      continuesBefore: startDay < weekStart,
      continuesAfter: endDay > weekEnd,
    });
  }
  return segments;
}

export function buildWeekSegments(events: CalendarEvent[], weekDays: Date[]): CalendarWeekSegment[] {
  return packWeekSegments(buildWeekSegmentsRaw(events, weekDays));
}

export function buildTimedFullDayWeekSegments(events: CalendarEvent[], weekDays: Date[]): CalendarWeekSegment[] {
  if (weekDays.length === 0) return [];

  // Direct loop + push. Was `events.flatMap(event => { ...; return segments; })`
  // which allocated a per-event inner array AND the outer flatMap array.
  // Per-event hoist: parseISO eventStart/eventEnd ONCE per event (was
  // re-parsed inside every `isTimedEventFullDayOnDate(event, day)` call —
  // up to 9 times per event for 7-day weeks + 2 boundary probes).
  // Inline the bounds check via a closure capturing the pre-parsed dates.
  // For 100 events × 9 probes that's ~1800 parseISO calls dropped per render.
  const rawSegments: CalendarWeekSegment[] = [];
  for (const event of events) {
    if (event.showWithoutTime) continue;
    const eventStart = getEventStartDate(event);
    const eventEnd = getEventEndDate(event);
    const isFullDay = (day: Date): boolean => {
      const dayStart = startOfDay(day);
      const nextDayStart = addDays(dayStart, 1);
      if (eventEnd <= dayStart || eventStart >= nextDayStart) return false;
      const clippedStart = eventStart > dayStart ? eventStart : dayStart;
      const clippedEnd = eventEnd < nextDayStart ? eventEnd : nextDayStart;
      const startMinutes = Math.max(0, Math.floor((clippedStart.getTime() - dayStart.getTime()) / 60000));
      const endMinutes = Math.min(1440, Math.ceil((clippedEnd.getTime() - dayStart.getTime()) / 60000));
      return startMinutes === 0 && endMinutes === 1440;
    };
    let rangeStart = -1;
    let previousIndex = -1;
    const pushSegment = (startIndex: number, endIndex: number) => {
      rawSegments.push({
        event,
        startIndex,
        span: endIndex - startIndex + 1,
        row: -1,
        continuesBefore: isFullDay(addDays(weekDays[startIndex], -1)),
        continuesAfter: isFullDay(addDays(weekDays[endIndex], 1)),
      });
    };
    for (let i = 0; i < weekDays.length; i++) {
      if (!isFullDay(weekDays[i])) continue;
      if (rangeStart === -1) {
        rangeStart = i;
      } else if (i !== previousIndex + 1) {
        pushSegment(rangeStart, previousIndex);
        rangeStart = i;
      }
      previousIndex = i;
    }
    if (rangeStart !== -1) pushSegment(rangeStart, previousIndex);
  }
  return packWeekSegments(rawSegments);
}

export function layoutOverlappingEvents(
  events: CalendarEvent[],
  day: Date,
): TimedEventLayout[] {
  // Direct loop + push. Was `events.flatMap(...)` returning `[]` or
  // `[{...}]` per event — one throwaway array per event.
  type LayoutInput = { event: CalendarEvent } & NonNullable<ReturnType<typeof getTimedEventBoundsForDay>>;
  const layoutInputs: LayoutInput[] = [];
  for (const event of events) {
    const bounds = getTimedEventBoundsForDay(event, day);
    if (bounds) layoutInputs.push({ event, ...bounds });
  }

  const sorted = layoutInputs.sort((a, b) => {
    const diff = a.startMinutes - b.startMinutes;
    if (diff !== 0) return diff;
    return (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes);
  });

  const result: TimedEventLayout[] = [];
  let columns: { event: CalendarEvent; end: number }[][] = [];
  let clusterStart = 0;
  let clusterMaxEnd = 0;

  const flushCluster = () => {
    const total = columns.length;
    for (let i = clusterStart; i < result.length; i++) {
      result[i].totalColumns = total;
    }
  };

  for (const event of sorted) {
    if (columns.length > 0 && event.startMinutes >= clusterMaxEnd) {
      flushCluster();
      clusterStart = result.length;
      columns = [];
      clusterMaxEnd = 0;
    }

    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      // Within each column, events are non-overlapping (column invariant)
      // and pushed in start-time order (we iterate `sorted`), so the last
      // entry has the latest end. Was `columns[col].every(e => e.end <= ...)`
      // which scanned every event in the column — O(K) per column-probe.
      // The last-entry check is O(1) and is logically sufficient.
      const colArr = columns[col];
      if (colArr[colArr.length - 1].end <= event.startMinutes) {
        colArr.push({ event: event.event, end: event.endMinutes });
        result.push({ ...event, column: col, totalColumns: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([{ event: event.event, end: event.endMinutes }]);
      result.push({ ...event, column: columns.length - 1, totalColumns: 0 });
    }
    clusterMaxEnd = Math.max(clusterMaxEnd, event.endMinutes);
  }

  flushCluster();
  return result;
}

export function formatSnapTime(minutes: number, timeFormat: "12h" | "24h"): string {
  const clamped = Math.max(0, Math.min(1440, minutes));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  if (timeFormat === "12h") {
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function getPrimaryCalendarId(event: Pick<CalendarEvent, 'calendarIds'>): string | undefined {
  // Zero-allocation first-key pick — was `Object.keys(...)[0]` which
  // built the full keys-array just to take index 0. Called per event
  // during calendar list rendering.
  const ids = event.calendarIds;
  if (!ids) return undefined;
  for (const k in ids) return k;
  return undefined;
}

export function formatIsoInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`;
}
