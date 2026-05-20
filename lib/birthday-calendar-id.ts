// Tiny constants module split out of lib/birthday-calendar.ts so
// calendar-store can reference BIRTHDAY_CALENDAR_ID without pulling the
// entire birthday-event generator (which imports date-fns helpers and
// contact-store). The big file's everything-else stays put for the
// calendar route to import directly.

export const BIRTHDAY_CALENDAR_ID = '__birthday-calendar__';
export const BIRTHDAY_CALENDAR_COLOR = '#eab308'; // Yellow
