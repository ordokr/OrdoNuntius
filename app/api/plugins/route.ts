import { NextResponse } from 'next/server';
import { getPluginRegistry, getThemeRegistry } from '@/lib/admin/plugin-registry';
import { listDevPlugins } from '@/lib/admin/plugin-dev';
import { logger } from '@/lib/logger';

// Hoisted no-store header object shared across responses.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/plugins - Public endpoint for clients to discover server-managed plugins & themes
 *
 * Returns all enabled plugins and themes so the client can sync them to IndexedDB.
 * No admin auth required - this is how regular users receive plugins/themes.
 */
export async function GET() {
  try {
    const [pluginRegistry, themeRegistry, devEntries] = await Promise.all([
      getPluginRegistry(),
      getThemeRegistry(),
      listDevPlugins(),
    ]);

    // Dev plugins win on id collision so a developer can shadow an installed
    // plugin without uninstalling it first.
    const devIds = new Set(devEntries.map(e => e.plugin.id));

    // Single-pass build: was 3 walks (map dev, filter+map installed, outer map projection).
    const plugins: Array<Record<string, unknown>> = [];
    for (const e of devEntries) {
      const p = e.plugin;
      plugins.push({
        id: p.id, name: p.name, version: p.version, author: p.author,
        description: p.description, type: p.type, permissions: p.permissions,
        entrypoint: p.entrypoint, forceEnabled: p.forceEnabled || false,
        bundleHash: p.bundleHash, updatedAt: p.updatedAt, dev: true,
        httpOrigins: p.httpOrigins, settingsSchema: p.settingsSchema,
      });
    }
    for (const p of pluginRegistry.plugins) {
      if (!p.enabled || devIds.has(p.id)) continue;
      plugins.push({
        id: p.id, name: p.name, version: p.version, author: p.author,
        description: p.description, type: p.type, permissions: p.permissions,
        entrypoint: p.entrypoint, forceEnabled: p.forceEnabled || false,
        bundleHash: p.bundleHash, updatedAt: p.updatedAt, dev: false,
        httpOrigins: p.httpOrigins, settingsSchema: p.settingsSchema,
      });
    }

    // Single-pass filter+map fusion (was .filter().map()).
    const themes: Array<Record<string, unknown>> = [];
    for (const t of themeRegistry.themes) {
      if (!t.enabled) continue;
      themes.push({
        id: t.id, name: t.name, version: t.version, author: t.author,
        description: t.description, variants: t.variants,
        forceEnabled: t.forceEnabled || false,
      });
    }

    return NextResponse.json(
      { plugins, themes },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    logger.error('Plugin list error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
