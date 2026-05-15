import { locales } from '@/i18n/routing';

export function replaceWindowLocation(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.replace(url);
}

// Build-time constant injected by next.config.ts. When the app is built with
// NEXT_PUBLIC_BASE_PATH=/webmail, Next.js itself prefixes routes and assets;
// helpers below use the same value so client code stays consistent.
const STATIC_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

// Memoized runtime-detected prefix. Computed lazily on first call from
// the browser and reused for the rest of the session. apiFetch is called
// ~100+ times per page load (every API request, push subscription, blob
// fetch, etc.); even microsecond work multiplied by that count is worth
// removing. The locale-supplied variant is NOT memoized because the
// answer depends on the argument.
let memoizedDefaultPrefix: string | null = null;

/**
 * Returns the mount prefix the app is served at.
 *
 * Resolution order:
 *  1. The build-time `NEXT_PUBLIC_BASE_PATH` constant (set in next.config.ts).
 *  2. Runtime detection from `window.location.pathname` for legacy deploys
 *     where the reverse proxy mounts the app at a subpath without rebuilding.
 *
 * If a locale is supplied (e.g. from route params) it anchors the runtime
 * detection; otherwise the first path segment that matches a known locale is
 * used.
 *
 * Returns '' when there is no prefix.
 */
export function getPathPrefix(locale?: string): string {
  if (STATIC_BASE_PATH) return STATIC_BASE_PATH;
  if (typeof window === 'undefined') return '';

  // Fast path: no locale arg → memoized session-constant value.
  if (!locale && memoizedDefaultPrefix !== null) return memoizedDefaultPrefix;

  const segments = window.location.pathname.split('/').filter(Boolean);

  let localeIndex: number;
  if (locale) {
    localeIndex = segments.indexOf(locale);
  } else {
    localeIndex = segments.findIndex(s =>
      (locales as readonly string[]).includes(s)
    );
  }

  const prefix = localeIndex <= 0 ? '' : '/' + segments.slice(0, localeIndex).join('/');
  if (!locale) memoizedDefaultPrefix = prefix;
  return prefix;
}

/**
 * Mount-prefix-aware wrapper around `fetch()`.
 *
 * When OrdoNuntius is served behind a reverse proxy at a sub-path (e.g. `/ordoNuntius`),
 * `fetch('/api/foo')` would target the browser origin at `/api/foo`, which the
 * proxy doesn't route. `apiFetch` detects the mount prefix from
 * `window.location.pathname` via `getPathPrefix()` at call time, so the same
 * built bundle works at any mount point without rebuilding.
 *
 * Only rewrites absolute paths that start with a single `/`. Protocol-relative
 * URLs (`//cdn.example.com/foo`) and absolute URLs (`https://...`) pass
 * through unchanged.
 *
 * Server code (route handlers, layout files running at SSR) should keep using
 * the raw Fetch API - the mount prefix is a browser-only concept.
 *
 * @example
 *   await apiFetch('/api/jmap', { method: 'POST', body })
 *   // Browser at /webmail/en/inbox  → /webmail/api/jmap
 *   // Browser at /en/inbox          → /api/jmap
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (input.startsWith('/') && !input.startsWith('//')) {
    return fetch(getPathPrefix() + input, init);
  }
  return fetch(input, init);
}


/**
 * Extracts the locale from the current URL, skipping any mount prefix.
 * Falls back to 'en' when no known locale segment is found.
 */
export function getLocaleFromPath(): string {
  if (typeof window === 'undefined') return 'en';

  const segments = window.location.pathname.split('/').filter(Boolean);
  const locale = segments.find(s =>
    (locales as readonly string[]).includes(s)
  );
  return locale || 'en';
}