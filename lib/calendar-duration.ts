/**
 * ISO 8601 duration helpers split out of `lib/calendar-utils.ts` and
 * `components/calendar/event-card.tsx` so `stores/calendar-store.ts` can
 * pull just these two functions without dragging the entire calendar
 * utility module (and its event-card import chain, ~15 KB) into the
 * inbox bundle through `NavigationRail → calendar-store`.
 */

// Single-regex ISO 8601 duration parser. Was 4 separate `duration.match(...)`
// calls per parse — each allocates a RegExpMatchArray. One match returns
// all components at once.
const DURATION_RE = /^P?(?:(\d+)W)?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

export function parseDuration(duration: string | undefined): number {
  if (!duration) return 0;
  const m = DURATION_RE.exec(duration);
  if (!m) return 0;
  let total = 0;
  if (m[1]) total += parseInt(m[1]) * 7 * 24 * 60;
  if (m[2]) total += parseInt(m[2]) * 24 * 60;
  if (m[3]) total += parseInt(m[3]) * 60;
  if (m[4]) total += parseInt(m[4]);
  // S (seconds) intentionally ignored — caller works in minutes.
  return total;
}

export function normalizeAllDayDuration(duration: string | undefined): string | undefined {
  if (!duration) return undefined;
  const totalMinutes = parseDuration(duration);
  const totalDays = Math.max(1, Math.ceil(totalMinutes / (24 * 60)));
  return `P${totalDays}D`;
}
