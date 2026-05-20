"use client";

import dynamic from 'next/dynamic';
import { ToastContainer } from '@/components/ui/toast';
import { useToastStore } from '@/stores/toast-store';

// The alert worker subscribes to calendar-store + task-store +
// calendar-notification-store and pulls in lib/calendar-alerts and
// lib/notification-sound. The provider wraps the entire [locale] tree,
// so eager-importing the worker would put that whole transitive set on
// every authenticated route's cold-load. The dynamic chunk loads
// post-mount; alerts fire on a 60s interval anyway, so the small load
// delay is invisible to users.
const CalendarAlertWorker = dynamic(
  () => import('./calendar-alert-worker').then(m => ({ default: m.CalendarAlertWorker })),
  { ssr: false, loading: () => null },
);

export function CalendarAlertProvider({ children }: { children: React.ReactNode }) {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <>
      <CalendarAlertWorker />
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}
