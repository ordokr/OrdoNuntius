import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/session';
import { logger } from '@/lib/logger';
import {
  loadState,
  checkOnce,
  effectiveEndpoint,
  disabledByEnv,
  DEFAULT_VERSION_ENDPOINT,
} from '@/lib/version-check';

// Resolve build-time env vars once at module load (constant per process).
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/admin/version
 * Returns the cached update status, last check times, and effective config.
 */
export async function GET() {
  try {
    const auth = await requireAdminAuth();
    if ('error' in auth) return auth.error;

    const state = await loadState();
    return NextResponse.json(
      {
        current: APP_VERSION,
        build: GIT_COMMIT,
        endpoint: effectiveEndpoint(state),
        defaultEndpoint: DEFAULT_VERSION_ENDPOINT,
        disabledByEnv: disabledByEnv(),
        lastCheckedAt: state.lastCheckedAt,
        lastSuccessAt: state.lastSuccessAt,
        nextScheduledAt: state.nextScheduledAt,
        status: state.status,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    logger.error('version admin GET error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

/**
 * POST /api/admin/version
 * { action: 'check-now' } - force a fresh upstream fetch.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminAuth();
    if ('error' in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as { action?: string } | null;
    if (!body || body.action !== 'check-now') {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    const result = await checkOnce({ reason: 'admin-trigger' });
    return NextResponse.json(result);
  } catch (err) {
    logger.error('version admin POST error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
