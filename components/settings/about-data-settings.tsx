"use client";

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/settings-store';
import { useConfig } from '@/hooks/use-config';
import { SettingsSection, SettingItem, ToggleSwitch } from './settings-section';
import { Button } from '@/components/ui/button';
import { usePolicyStore } from '@/stores/policy-store';
import { useUpdateStore } from '@/stores/update-store';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpamSiegeGame } from './spam-siege-game';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT || "unknown";

function VersionUpdateTag() {
  const status = useUpdateStore((s) => s.status);
  const startPolling = useUpdateStore((s) => s.startPolling);

  useEffect(() => {
    startPolling();
  }, [startPolling]);

  if (!status?.updateAvailable) return null;
  if (status.severity === 'unknown' || status.severity === 'none') return null;

  const important = status.severity === 'security' || status.severity === 'deprecated';
  const label =
    status.severity === 'security' ? 'security'
    : status.severity === 'deprecated' ? 'deprecated'
    : status.latest ?? 'update';

  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium align-middle",
        important
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      )}
    >
      {important ? label : `update: ${label}`}
    </span>
  );
}

export function AboutDataSettings() {
  const t = useTranslations('settings.advanced');
  const tCommon = useTranslations('common');
  // next-intl has no namespace traversal — the previous code's
  // `t('../../settings.import_success')` looked up the literal key
  // `../../settings.import_success` under `settings.advanced` and
  // silently failed (returned the raw key path). Cross-namespace
  // resolution needs its own translator scoped to the target.
  const tSettings = useTranslations('settings');
  // Granular selectors: subscribing to the whole store re-rendered this panel
  // on every settings mutation. Actions are stable in zustand → safe to pull
  // individually without changing render identity.
  const settingsSyncDisabled = useSettingsStore(s => s.settingsSyncDisabled);
  const updateSetting = useSettingsStore(s => s.updateSetting);
  const resetToDefaults = useSettingsStore(s => s.resetToDefaults);
  const exportSettings = useSettingsStore(s => s.exportSettings);
  const importSettings = useSettingsStore(s => s.importSettings);
  const { settingsSyncEnabled } = useConfig();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFeatureEnabled = usePolicyStore(s => s.isFeatureEnabled);
  const [showGame, setShowGame] = useState(false);
  const logoClickCount = useRef(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoClick = () => {
    logoClickCount.current++;
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);
    if (logoClickCount.current >= 3) {
      logoClickCount.current = 0;
      setShowGame(true);
    } else {
      logoClickTimer.current = setTimeout(() => { logoClickCount.current = 0; }, 2000);
    }
  };

  const handleExport = () => {
    const settingsJson = exportSettings();
    const blob = new Blob([settingsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `webmail-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const json = event.target?.result as string;
      const success = importSettings(json);
      if (success) {
        alert(tSettings('import_success'));
      } else {
        alert(tSettings('import_error'));
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (showResetConfirm) {
      resetToDefaults();
      setShowResetConfirm(false);
      alert(tSettings('save_success'));
    } else {
      setShowResetConfirm(true);
      setTimeout(() => setShowResetConfirm(false), 5000);
    }
  };

  return (
    <>
      {showGame && <SpamSiegeGame onClose={() => setShowGame(false)} />}
      <div className="rounded-lg border border-border bg-card p-5 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={handleLogoClick} className="flex items-center gap-4 flex-1 text-left focus:outline-none group/about cursor-pointer" aria-label="About">
            <div className="shrink-0">
              <img
                src="/branding/OrdoNuntius_Logo_Color.svg"
                alt="OrdoNuntius"
                className="w-12 h-12 object-contain dark:hidden group-hover/about:scale-105 group-active/about:scale-95 transition-transform"
              />
              <img
                src="/branding/OrdoNuntius_Logo_White.svg"
                alt="OrdoNuntius"
                className="w-12 h-12 object-contain hidden dark:block group-hover/about:scale-105 group-active/about:scale-95 transition-transform"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('about.title')}
              </p>
              <p className="text-xs text-muted-foreground group-hover/about:translate-x-0.5 group-active/about:translate-y-px transition-transform">
                v{APP_VERSION} <span className="text-muted-foreground/60">({GIT_COMMIT})</span>
                <VersionUpdateTag />
              </p>
            </div>
          </button>
          <a
            href="https://github.com/ordokr/OrdoNuntius"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <SettingsSection title={t('title')} description={t('description')}>
        {settingsSyncEnabled && (
          <SettingItem label={t('settings_sync.label')} description={t('settings_sync.description')}>
            <ToggleSwitch checked={!settingsSyncDisabled} onChange={(checked) => updateSetting('settingsSyncDisabled', !checked)} />
          </SettingItem>
        )}

        {isFeatureEnabled('settingsExportEnabled') && (
        <SettingItem label={t('export_settings.label')} description={t('export_settings.description')}>
          <Button variant="outline" size="sm" onClick={handleExport}>
            {t('export_settings.button')}
          </Button>
        </SettingItem>
        )}

        {isFeatureEnabled('settingsExportEnabled') && (
        <SettingItem label={t('import_settings.label')} description={t('import_settings.description')}>
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button variant="outline" size="sm" onClick={handleImport}>
              {t('import_settings.button')}
            </Button>
          </>
        </SettingItem>
        )}

        <SettingItem label={t('reset_settings.label')} description={t('reset_settings.description')}>
          <Button
            variant={showResetConfirm ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleReset}
          >
            {showResetConfirm ? tCommon('yes') : t('reset_settings.button')}
          </Button>
        </SettingItem>
      </SettingsSection>
    </>
  );
}
