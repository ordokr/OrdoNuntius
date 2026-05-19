import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const RETENTION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface CalendarNotificationStore {
  acknowledgedAlerts: Record<string, number>;
  acknowledgeAlert: (key: string, fireTimeMs: number) => void;
  isAcknowledged: (key: string) => boolean;
  cleanupStaleAlerts: () => void;
  clearAll: () => void;
}

export const useCalendarNotificationStore = create<CalendarNotificationStore>()(
  persist(
    (set, get) => ({
      acknowledgedAlerts: {},

      acknowledgeAlert: (key, fireTimeMs) => {
        set((state) => ({
          acknowledgedAlerts: { ...state.acknowledgedAlerts, [key]: fireTimeMs },
        }));
      },

      isAcknowledged: (key) => {
        return key in get().acknowledgedAlerts;
      },

      cleanupStaleAlerts: () => {
        const now = Date.now();
        // Direct for...in build instead of Object.fromEntries(entries.filter):
        // drops the entries-array, filter-array, and the fromEntries object
        // re-allocation. Runs periodically via setInterval to prune old
        // acknowledgements; small N typically but skipping three allocations
        // costs nothing.
        const src = get().acknowledgedAlerts;
        const cleaned: Record<string, number> = {};
        for (const key in src) {
          const fireTimeMs = src[key];
          if (now - fireTimeMs < RETENTION_THRESHOLD_MS) cleaned[key] = fireTimeMs;
        }
        set({ acknowledgedAlerts: cleaned });
      },

      clearAll: () => {
        set({ acknowledgedAlerts: {} });
      },
    }),
    {
      name: 'calendar-notification-storage',
      partialize: (state) => ({
        acknowledgedAlerts: state.acknowledgedAlerts,
      }),
    }
  )
);
