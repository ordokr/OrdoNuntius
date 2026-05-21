import { NextRequest, NextResponse } from 'next/server';
import { appendFile } from 'node:fs/promises';
import { getClientIP } from '@/lib/admin/session';
import { logger } from '@/lib/logger';

// Beacon endpoint for Web Vitals client reports. Anonymous — same-origin
// operational data, kept on the operator's own server. Disable by setting
// WEB_VITALS_BEACON=off in the service env.
//
// Records are appended to WEB_VITALS_LOG_PATH (default
// /var/log/ordonuntius/web-vitals.jsonl) as one JSON line per metric. View
// with: `tail -F /var/log/ordonuntius/web-vitals.jsonl`. The dedicated file
// dodges Node's pipe-buffered stdout, which can swallow console.log output
// from a Next.js standalone server for indefinite periods.

const ENABLED = process.env.WEB_VITALS_BEACON?.toLowerCase() !== 'off';
const LOG_PATH = process.env.WEB_VITALS_LOG_PATH || '/var/log/ordonuntius/web-vitals.jsonl';

// Tiny in-memory token bucket per IP. The user is essentially the only
// real user; this is a DoS guard, not a real quota.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT_MAX;
}

// Periodic GC so the Map doesn't grow unbounded over weeks of uptime.
// Runs at most once per minute, only on a request.
let _lastGc = 0;
function maybeGc() {
  const now = Date.now();
  if (now - _lastGc < 60_000) return;
  _lastGc = now;
  for (const [ip, b] of buckets) {
    if (b.resetAt < now) buckets.delete(ip);
  }
}

const VALID_METRICS = new Set(['CLS', 'LCP', 'FCP', 'INP', 'TTFB']);

interface BeaconPayload {
  name: unknown;
  value: unknown;
  rating: unknown;
  id: unknown;
  delta: unknown;
  navigationType: unknown;
  path: unknown;
  connection: unknown;
}

export async function POST(request: NextRequest) {
  if (!ENABLED) return new NextResponse(null, { status: 204 });

  const ip = getClientIP(request);
  if (rateLimited(ip)) {
    return new NextResponse(null, { status: 429 });
  }
  maybeGc();

  // Cap body size — beacons are tiny.
  const cl = request.headers.get('content-length');
  if (cl && parseInt(cl, 10) > 2048) {
    return new NextResponse(null, { status: 413 });
  }

  let body: BeaconPayload | null;
  try {
    body = (await request.json()) as BeaconPayload;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return new NextResponse(null, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name : null;
  if (!name || !VALID_METRICS.has(name)) {
    return new NextResponse(null, { status: 400 });
  }
  const value = typeof body.value === 'number' && Number.isFinite(body.value) ? body.value : null;
  if (value === null) {
    return new NextResponse(null, { status: 400 });
  }

  const rating = typeof body.rating === 'string' ? body.rating : undefined;
  const id = typeof body.id === 'string' ? body.id.slice(0, 64) : undefined;
  const delta = typeof body.delta === 'number' && Number.isFinite(body.delta) ? body.delta : undefined;
  const navigationType = typeof body.navigationType === 'string' ? body.navigationType : undefined;
  // The client sanitizes the path before sending; cap defensively here too.
  const path = typeof body.path === 'string' ? body.path.slice(0, 128) : undefined;
  const connection = typeof body.connection === 'string' ? body.connection.slice(0, 32) : undefined;

  const entry = {
    ts: new Date().toISOString(),
    metric: name,
    value: Math.round(value * 100) / 100,
    rating,
    id,
    delta: delta !== undefined ? Math.round(delta * 100) / 100 : undefined,
    navigationType,
    path,
    connection,
    ua: request.headers.get('user-agent')?.slice(0, 128),
  };

  // Fire-and-forget append. If the file write fails (path unwritable, disk
  // full), fall back to logger so the metric isn't silently lost — even if
  // logger output is currently invisible in journal due to stdout buffering,
  // it'll surface if the operator switches log shipping.
  appendFile(LOG_PATH, JSON.stringify(entry) + '\n').catch((err) => {
    logger.warn('web-vitals: appendFile failed', {
      error: err instanceof Error ? err.message : String(err),
      path: LOG_PATH,
    });
  });

  // 204 No Content keeps sendBeacon happy with the minimum response.
  return new NextResponse(null, { status: 204 });
}
