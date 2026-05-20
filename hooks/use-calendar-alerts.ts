"use client";

import { useEffect, useRef, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { parseISO } from 'date-fns';
import { useAuthStore } from '@/stores/auth-store';
import { useCalendarStore } from '@/stores/calendar-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { useCalendarNotificationStore } from '@/stores/calendar-notification-store';
import { useToastStore } from '@/stores/toast-store';
import { getPendingAlerts, getPendingTaskAlerts, buildAlertKey } from '@/lib/calendar-alerts';
import { playNotificationSound } from '@/lib/notification-sound';
import { getPathPrefix } from '@/lib/browser-navigation';
import type { CalendarEvent } from '@/lib/jmap/types';

const CHECK_INTERVAL_MS = 60 * 1000;
const PROACTIVE_FETCH_HOURS = 24;
const PROACTIVE_THROTTLE_MS = CHECK_INTERVAL_MS * 5;

export function useCalendarAlerts() {
  // Per-field selectors instead of whole-store destructures. This hook
  // mounts at the app shell level and was re-running on every set() in
  // 5 different stores — including mutations it didn't read (auth username
  // changes, task add/edit/delete, settings unrelated to alerts).
  // Actions are stable; pull them via getState() inside callbacks.
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const client = useAuthStore(s => s.client);
  const events = useCalendarStore(s => s.events);
  const calendars = useCalendarStore(s => s.calendars);
  const supportsCalendar = useCalendarStore(s => s.supportsCalendar);
  const calendarNotificationsEnabled = useSettingsStore(s => s.calendarNotificationsEnabled);
  const calendarNotificationSound = useSettingsStore(s => s.calendarNotificationSound);
  const enableCalendarTasks = useSettingsStore(s => s.enableCalendarTasks);
  const notificationSoundChoice = useSettingsStore(s => s.notificationSoundChoice);
  const storeTasks = useTaskStore(s => s.tasks);
  const acknowledgedAlerts = useCalendarNotificationStore(s => s.acknowledgedAlerts);
  const addToast = useToastStore((s) => s.addToast);
  const t = useTranslations('calendar.notifications');
  const locale = useLocale();

  const lastProactiveFetchRef = useRef<number>(0);
  const proactiveEventsRef = useRef<CalendarEvent[]>([]);
  const shownKeysRef = useRef<Set<string>>(new Set());

  const checkAlerts = useCallback(() => {
    if (!calendarNotificationsEnabled || !isAuthenticated) return;

    try {
      const now = Date.now();
      // Direct Set build skips the Object.keys intermediate array.
      // The alert-check loop fires periodically (per minute) so the
      // saved allocation isn't huge but the pattern is free.
      const acknowledgedKeys = new Set<string>();
      for (const k in acknowledgedAlerts) acknowledgedKeys.add(k);
      // Skip the spread allocation when proactive cache is empty (common case
      // — only populated after the first 5-min throttle window elapses).
      const proactive = proactiveEventsRef.current;
      const allEvents = proactive.length === 0 ? events : [...events, ...proactive];
      const pending = getPendingAlerts(allEvents, calendars, acknowledgedKeys, now);

      for (const alert of pending) {
        const key = buildAlertKey(alert.eventId, alert.alertId, alert.fireTimeMs);
        if (shownKeysRef.current.has(key)) continue;

        shownKeysRef.current.add(key);
        useCalendarNotificationStore.getState().acknowledgeAlert(key, alert.fireTimeMs);

        if (calendarNotificationSound) {
          playNotificationSound(notificationSoundChoice);
        }

        const diffMs = (alert.event.utcStart ? new Date(alert.event.utcStart).getTime() : parseISO(alert.event.start).getTime()) - now;
        const diffMin = Math.round(diffMs / 60000);

        const timeLabel = diffMin <= 0
          ? t('alert_now')
          : t('alert_in_minutes', { count: diffMin });

        const message = alert.calendarName
          ? `${timeLabel} · ${alert.calendarName}`
          : timeLabel;

        addToast({
          type: 'info',
          title: alert.event.title || t('alert_title'),
          message,
          duration: 15000,
          onClick: () => {
            window.location.href = `${getPathPrefix(locale)}/${locale}/calendar`;
          },
        });
      }

      // Task alerts
      if (enableCalendarTasks && storeTasks.length > 0) {
        const pendingTaskAlerts = getPendingTaskAlerts(storeTasks, calendars, acknowledgedKeys, now);
        for (const taskAlert of pendingTaskAlerts) {
          const key = buildAlertKey(taskAlert.taskId, taskAlert.alertId, taskAlert.fireTimeMs);
          if (shownKeysRef.current.has(key)) continue;

          shownKeysRef.current.add(key);
          useCalendarNotificationStore.getState().acknowledgeAlert(key, taskAlert.fireTimeMs);

          if (calendarNotificationSound) {
            playNotificationSound(notificationSoundChoice);
          }

          const taskMsg = taskAlert.calendarName
            ? `${t('task_due')} · ${taskAlert.calendarName}`
            : t('task_due');

          addToast({
            type: 'info',
            title: taskAlert.task.title || t('alert_title'),
            message: taskMsg,
            duration: 15000,
            onClick: () => {
              window.location.href = `${getPathPrefix(locale)}/${locale}/calendar`;
            },
          });
        }
      }
    } catch {
      // Silently ignore alert evaluation errors
    }
  }, [
    calendarNotificationsEnabled, calendarNotificationSound, notificationSoundChoice,
    isAuthenticated, events, calendars, acknowledgedAlerts,
    addToast, t, locale, enableCalendarTasks, storeTasks,
  ]);

  const proactiveFetch = useCallback(async () => {
    if (!client || !supportsCalendar || !calendarNotificationsEnabled || !isAuthenticated) return;

    const now = Date.now();
    if (now - lastProactiveFetchRef.current < PROACTIVE_THROTTLE_MS) return;

    try {
      const start = new Date(now - 10 * 60 * 1000).toISOString();
      const end = new Date(now + PROACTIVE_FETCH_HOURS * 60 * 60 * 1000).toISOString();
      const fetched = await client.queryCalendarEvents({ after: start, before: end });
      proactiveEventsRef.current = fetched;
      lastProactiveFetchRef.current = Date.now();
    } catch {
      // Silently ignore proactive fetch errors
    }
  }, [client, supportsCalendar, calendarNotificationsEnabled, isAuthenticated]);

  useEffect(() => {
    if (!calendarNotificationsEnabled || !isAuthenticated) return;

    useCalendarNotificationStore.getState().cleanupStaleAlerts();
    proactiveFetch();

    const timer = setTimeout(() => checkAlerts(), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, calendarNotificationsEnabled]);

  useEffect(() => {
    if (!calendarNotificationsEnabled || !isAuthenticated) return;

    const interval = setInterval(() => {
      proactiveFetch();
      checkAlerts();
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [calendarNotificationsEnabled, isAuthenticated, checkAlerts, proactiveFetch]);

  useEffect(() => {
    if (!calendarNotificationsEnabled || !isAuthenticated) return;
    checkAlerts();
  }, [events, calendarNotificationsEnabled, isAuthenticated, checkAlerts]);
}
