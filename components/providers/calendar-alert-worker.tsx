"use client";

// Hook-only component for the calendar/task alert polling loop.
// Split off CalendarAlertProvider so the provider — which wraps the
// entire [locale] tree — doesn't statically import useCalendarAlerts,
// which would drag calendar-store (~1093 LOC) + task-store +
// calendar-notification-store + lib/calendar-alerts + lib/notification-sound
// into every authenticated route's boot bundle. The worker is
// dynamic-imported in the provider with `ssr: false`, so the alert
// machinery only loads after first paint of the app shell.

import { useCalendarAlerts } from '@/hooks/use-calendar-alerts';

export function CalendarAlertWorker(): null {
  useCalendarAlerts();
  return null;
}
