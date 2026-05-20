'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAdminTabStore, isAdminTab } from '@/stores/admin-tab-store';

// One tab shown at a time. Lazy each so only the active tab's chunk
// loads on first paint. Heaviest tabs (themes 22.7K, plugins 19.0K,
// auth 18.7K, marketplace 13.6K) used to all bundle into the route's
// initial JS together.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dyn = (loader: () => Promise<{ default: React.ComponentType<any> }>) =>
  dynamic(loader, { ssr: false, loading: () => null });
const DashboardTab = dyn(() => import('./_tabs/dashboard').then(m => ({ default: m.DashboardTab })));
const SettingsTab = dyn(() => import('./_tabs/settings').then(m => ({ default: m.SettingsTab })));
const BrandingTab = dyn(() => import('./_tabs/branding').then(m => ({ default: m.BrandingTab })));
const AuthTab = dyn(() => import('./_tabs/auth').then(m => ({ default: m.AuthTab })));
const PolicyTab = dyn(() => import('./_tabs/policy').then(m => ({ default: m.PolicyTab })));
const PluginsTab = dyn(() => import('./_tabs/plugins').then(m => ({ default: m.PluginsTab })));
const ThemesTab = dyn(() => import('./_tabs/themes').then(m => ({ default: m.ThemesTab })));
const MarketplaceTab = dyn(() => import('./_tabs/marketplace').then(m => ({ default: m.MarketplaceTab })));
const VersionTab = dyn(() => import('./_tabs/version').then(m => ({ default: m.VersionTab })));
const TelemetryTab = dyn(() => import('./_tabs/telemetry').then(m => ({ default: m.TelemetryTab })));
const LogsTab = dyn(() => import('./_tabs/logs').then(m => ({ default: m.LogsTab })));

export default function AdminPage() {
  const activeTab = useAdminTabStore((s) => s.activeTab);
  const setActiveTab = useAdminTabStore((s) => s.setActiveTab);

  // Honour deep links from the old route structure: /admin?tab=settings
  // (emitted by the redirect pages in /admin/<x>/page.tsx) sets the store
  // once on mount, then strips the param so the URL stays at /admin and
  // subsequent tab clicks don't accumulate query strings.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('tab');
    if (isAdminTab(fromUrl)) {
      setActiveTab(fromUrl);
      url.searchParams.delete('tab');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, [setActiveTab]);

  switch (activeTab) {
    case 'dashboard': return <DashboardTab />;
    case 'settings': return <SettingsTab />;
    case 'branding': return <BrandingTab />;
    case 'auth': return <AuthTab />;
    case 'policy': return <PolicyTab />;
    case 'plugins': return <PluginsTab />;
    case 'themes': return <ThemesTab />;
    case 'marketplace': return <MarketplaceTab />;
    case 'version': return <VersionTab />;
    case 'telemetry': return <TelemetryTab />;
    case 'logs': return <LogsTab />;
  }
}
