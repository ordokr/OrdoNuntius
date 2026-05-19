"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useUIStore } from "@/stores/ui-store";

// Tailwind v4 breakpoints
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

const getMediaQueryServerSnapshot = () => false;

// Module-level MediaQueryList cache. window.matchMedia returns the SAME
// MQL object for the same query, but we still pay the lookup cost on every
// getSnapshot call (called on every render of every component that uses a
// media query). With useIsMobile / useIsDesktop / useIsTablet sprinkled
// across the layout these add up — cache the lookup.
const _mqlCache = new Map<string, MediaQueryList>();
function getMql(query: string): MediaQueryList {
  let mql = _mqlCache.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    _mqlCache.set(query, mql);
  }
  return mql;
}

/**
 * SSR-safe media query hook. On SSR and the first hydration pass we report
 * `false`; on all subsequent client renders (including client-side navigation
 * remounts) we read `matchMedia` synchronously, so components don't flash
 * through a one-frame "mobile" layout on desktop.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const mq = getMql(query);
      mq.addEventListener("change", callback);
      return () => mq.removeEventListener("change", callback);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => getMql(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getMediaQueryServerSnapshot);
}

/**
 * Hook to detect device type and sync with UI store
 * Uses Tailwind breakpoints: mobile < 768px, tablet 768-1024px, desktop > 1024px
 */
export function useDeviceDetection() {
  // Per-field selectors instead of whole-store subscription. The previous
  // destructure re-rendered every consumer of useDeviceDetection() (the
  // top-level app page + email viewer) on every UI-store mutation —
  // sidebar resize, drag-drop transitions, etc. Now only re-renders when
  // these 3 specific booleans change.
  const isMobile = useUIStore(s => s.isMobile);
  const isTablet = useUIStore(s => s.isTablet);
  const isDesktop = useUIStore(s => s.isDesktop);

  const isMobileQuery = useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
  const isTabletQuery = useMediaQuery(
    `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`
  );
  const isDesktopQuery = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);

  useEffect(() => {
    // setDeviceType is a stable zustand action ref; reading it inside
    // the effect avoids subscribing for the action ref alone.
    useUIStore.getState().setDeviceType(isMobileQuery, isTabletQuery, isDesktopQuery);
  }, [isMobileQuery, isTabletQuery, isDesktopQuery]);

  return { isMobile, isTablet, isDesktop };
}

/**
 * Convenience hooks for specific breakpoints. Query strings are
 * module-level constants so callers don't re-build them per render
 * (matters because useMediaQuery's useCallback deps key off the
 * string identity to skip resubscribing).
 */
const QUERY_MOBILE = `(max-width: ${BREAKPOINTS.md - 1}px)`;
const QUERY_TABLET = `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`;
const QUERY_DESKTOP = `(min-width: ${BREAKPOINTS.lg}px)`;

export function useIsMobile() {
  return useMediaQuery(QUERY_MOBILE);
}

export function useIsTablet() {
  return useMediaQuery(QUERY_TABLET);
}

export function useIsDesktop() {
  return useMediaQuery(QUERY_DESKTOP);
}

export function useBreakpoint(breakpoint: keyof typeof BREAKPOINTS) {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[breakpoint]}px)`);
}
