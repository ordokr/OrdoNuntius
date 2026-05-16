import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getPublicConfig } from '@/lib/admin/bootstrap-payload';

/**
 * Runtime configuration endpoint
 *
 * This endpoint serves configuration values that can be set at runtime
 * via environment variables or admin dashboard overrides, enabling
 * post-build configuration for Docker deployments.
 *
 * On cold load, the same payload is inlined into the SSR HTML by
 * app/layout.tsx so most callers never hit this route — see
 * lib/admin/bootstrap-payload.ts. This endpoint remains for clients
 * that need a runtime refresh (admin pages, post-config-change polling).
 *
 * Priority order (handled by configManager):
 * 1. Admin dashboard overrides (data/admin/config.json)
 * 2. Runtime env vars (APP_NAME, JMAP_SERVER_URL)
 * 3. Build-time env vars (NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_JMAP_SERVER_URL)
 * 4. Default values
 */
export async function GET() {
  logger.debug('Config requested');
  return NextResponse.json(await getPublicConfig());
}
