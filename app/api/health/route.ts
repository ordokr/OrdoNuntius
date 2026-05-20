import v8 from 'node:v8';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

const MEMORY_WARNING_THRESHOLD = 0.85;
const MEMORY_CRITICAL_THRESHOLD = 0.95;
// Hoist threshold-as-percent + env-derived metadata once.
const WARN_PCT = MEMORY_WARNING_THRESHOLD * 100;
const CRIT_PCT = MEMORY_CRITICAL_THRESHOLD * 100;
const PKG_VERSION = process.env.npm_package_version || '0.1.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
} as const;

function getHeapUsagePercent(heapUsed: number, heapTotal: number): number {
  const heapSizeLimit = v8.getHeapStatistics().heap_size_limit;
  const denominator = heapSizeLimit > 0 ? heapSizeLimit : heapTotal;

  if (denominator <= 0) {
    return 0;
  }

  return (heapUsed / denominator) * 100;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime?: number;
  version?: string;
  memory?: {
    heapUsed: number;
    heapTotal: number;
    heapSizeLimit: number;
    rss: number;
    external: number;
    heapUsagePercent: number;
  };
  environment?: string;
  nodeVersion?: string;
  warnings?: string[];
  reason?: string;
}

/**
 * Health check endpoint for container orchestration
 *
 * GET /api/health - Liveness probe for container orchestration
 * GET /api/health?detailed=true - Diagnostics with advisory memory warnings
 * HEAD /api/health - Lightweight liveness probe (status code only)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const detailed = searchParams.get('detailed') === 'true';

  try {
    const timestamp = new Date().toISOString();
    const memUsage = process.memoryUsage();
    const heapSizeLimit = v8.getHeapStatistics().heap_size_limit;
    const heapUsagePercent = getHeapUsagePercent(memUsage.heapUsed, memUsage.heapTotal);
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const warnings: string[] = [];

    if (heapUsagePercent >= CRIT_PCT) {
      status = 'degraded';
      warnings.push(`V8 heap usage is very high: ${heapUsagePercent.toFixed(1)}% of heap limit`);
    } else if (heapUsagePercent >= WARN_PCT) {
      status = 'degraded';
      warnings.push(`V8 heap usage is high: ${heapUsagePercent.toFixed(1)}% of heap limit`);
    }

    const response: HealthStatus = {
      status: detailed ? status : 'healthy',
      timestamp,
    };

    if (detailed) {
      response.uptime = process.uptime();
      response.version = PKG_VERSION;
      response.memory = {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        heapSizeLimit,
        rss: memUsage.rss,
        external: memUsage.external,
        heapUsagePercent: Number(heapUsagePercent.toFixed(2)),
      };
      response.environment = NODE_ENV;
      response.nodeVersion = process.version;

      if (warnings.length > 0) {
        response.warnings = warnings;
      }
    }

    return NextResponse.json(response, {
      status: 200,
      headers: NO_CACHE_HEADERS,
    });

  } catch (error) {
    logger.error('Health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        reason: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}

/**
 * HEAD method for ultra-lightweight health checks
 */
export async function HEAD() {
  try {
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
