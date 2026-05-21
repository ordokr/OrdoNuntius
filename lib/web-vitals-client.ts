// Client-side Web Vitals beacon. Dynamic-imports the `web-vitals` library
// after first paint so it never blocks cold-load, then forwards each finalized
// metric to /api/web-vitals via navigator.sendBeacon (so it survives page
// hide / bfcache eviction).
//
// Server side: see app/api/web-vitals/route.ts.
//
// Disable via env: NEXT_PUBLIC_WEB_VITALS_BEACON=off (rebuild required since
// public env vars are inlined at build time).

interface Metric {
  name: 'CLS' | 'LCP' | 'FCP' | 'INP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
  delta: number;
  navigationType: string;
}

let initialized = false;

function sanitizePath(pathname: string): string {
  // Strip locale-suffix-only differences and keep the route. Locale lives
  // at the first segment so `/en/calendar` stays as-is — useful per-route
  // signal. Cap at 128 chars defensively.
  return pathname.replace(/[?#].*$/, '').slice(0, 128);
}

function connectionHint(): string | undefined {
  // Connection API is not on the Navigator type by default.
  const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  return c?.effectiveType;
}

function send(metric: Metric): void {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
    navigationType: metric.navigationType,
    path: sanitizePath(location.pathname),
    connection: connectionHint(),
  });
  try {
    // sendBeacon returns false if the queue is full or size is over limit;
    // fall through to fetch keepalive in that case.
    if (navigator.sendBeacon && navigator.sendBeacon('/api/web-vitals', body)) return;
  } catch {
    // sendBeacon can throw on permissions-policy-restricted iframes.
  }
  // Fallback: fire-and-forget POST with keepalive so it survives unload.
  fetch('/api/web-vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export async function startWebVitalsReporter(): Promise<void> {
  if (initialized) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (process.env.NEXT_PUBLIC_WEB_VITALS_BEACON?.toLowerCase() === 'off') return;
  initialized = true;

  try {
    const { onCLS, onLCP, onFCP, onINP, onTTFB } = await import('web-vitals');
    onCLS(send);
    onLCP(send);
    onFCP(send);
    onINP(send);
    onTTFB(send);
  } catch {
    // web-vitals dynamic import failed (network, etc.); silently abort —
    // missing metrics is fine.
  }
}
