import { NextResponse } from 'next/server';
import { checkOnce, loadState } from '@/lib/version-check';

// Resolve env once + hoist response headers — both never change at runtime.
const IS_DEV = process.env.NODE_ENV === 'development';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

// Public endpoint that returns the latest cached update status. Fed by the
// background scheduler started in instrumentation.node.ts; in production we
// never trigger a fresh upstream fetch from this route so an unauthenticated
// client can't use it to amplify traffic to the version server.
//
// In development we force a fresh fetch on every hit so changes to the
// version server's overrides take effect on the next page reload instead of
// requiring a dev-server restart. The 5s upstream timeout in fetchStatus
// caps the worst-case latency added to a dev reload.
export async function GET() {
  if (IS_DEV) {
    await checkOnce({ reason: 'dev-reload' });
  }

  const state = await loadState();
  return NextResponse.json(
    {
      status: state.status,
      lastCheckedAt: state.lastCheckedAt,
      lastSuccessAt: state.lastSuccessAt,
    },
    {
      headers: NO_STORE_HEADERS,
    },
  );
}
