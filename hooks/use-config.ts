"use client";

import { useState, useEffect } from 'react';
import { usePolicyStore } from '@/stores/policy-store';
import { apiFetch } from '@/lib/browser-navigation';
import type { PublicJmapServerEntry } from '@/lib/admin/jmap-servers';
import type { SettingsPolicy } from '@/lib/admin/types';

// SSR-inlined bootstrap payload (see lib/admin/bootstrap-payload.ts).
// Reading from the inline <script> tag avoids a network roundtrip on
// cold load. The hydrate happens lazily on first access so SSR/tests
// without the script tag still fall back to fetch.
const BOOTSTRAP_SCRIPT_ID = "__ORDO_BOOTSTRAP__";

interface ConfigData {
  appName: string;
  jmapServerUrl: string;
  oauthEnabled: boolean;
  oauthOnly: boolean;
  oauthClientId: string;
  oauthIssuerUrl: string;
  rememberMeEnabled: boolean;
  settingsSyncEnabled: boolean;
  stalwartFeaturesEnabled: boolean;
  devMode: boolean;
  faviconUrl: string;
  appLogoLightUrl: string;
  appLogoDarkUrl: string;
  loginLogoLightUrl: string;
  loginLogoDarkUrl: string;
  loginCompanyName: string;
  loginImprintUrl: string;
  loginPrivacyPolicyUrl: string;
  loginWebsiteUrl: string;
  demoMode: boolean;
  autoSsoEnabled: boolean;
  allowCustomJmapEndpoint: boolean;
  jmapServers: PublicJmapServerEntry[];
  jmapServerAutoPickByDomain: boolean;
  embeddedMode: boolean;
  parentOrigin: string;
}

interface AppConfig extends ConfigData {
  isLoading: boolean;
  error: string | null;
}

function readInlineBootstrap(): { config: ConfigData; policy: unknown } | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(BOOTSTRAP_SCRIPT_ID);
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

// Default values used when no config has loaded yet. Two surfaces care:
// fresh page render before the inline-bootstrap path has run (rare; this
// module runs synchronously at import time), and tests / non-SSR
// environments where neither the inline script nor the fetch has
// completed.
const CONFIG_DEFAULTS: ConfigData = {
  appName: "Webmail",
  jmapServerUrl: "",
  oauthEnabled: false,
  oauthOnly: false,
  oauthClientId: "",
  oauthIssuerUrl: "",
  rememberMeEnabled: false,
  settingsSyncEnabled: false,
  // Stalwart features are on-by-default; matches bootstrap-payload.ts.
  stalwartFeaturesEnabled: true,
  devMode: false,
  faviconUrl: "/branding/OrdoNuntius_Favicon.svg",
  appLogoLightUrl: "",
  appLogoDarkUrl: "",
  loginLogoLightUrl: "/branding/OrdoNuntius_Logo_Color.svg",
  loginLogoDarkUrl: "/branding/OrdoNuntius_Logo_White.svg",
  loginCompanyName: "",
  loginImprintUrl: "",
  loginPrivacyPolicyUrl: "",
  loginWebsiteUrl: "",
  demoMode: false,
  autoSsoEnabled: false,
  allowCustomJmapEndpoint: false,
  jmapServers: [],
  jmapServerAutoPickByDomain: false,
  embeddedMode: false,
  parentOrigin: "",
};

function appConfigFrom(
  data: ConfigData | null,
  isLoading: boolean,
  error: string | null,
): AppConfig {
  const src = data ?? CONFIG_DEFAULTS;
  return { ...src, jmapServers: src.jmapServers ?? [], isLoading, error };
}

let configCache: ConfigData | null = null;
let configPromise: Promise<ConfigData> | null = null;

// Eagerly hydrate from the SSR-inlined bootstrap payload. This runs once
// at module load on the client and populates the cache + the policy store
// synchronously — by the time any component calls useConfig(), the data
// is already there. Falls through to fetch on the rare path where the
// script tag is missing (legacy preview environments, error pages, etc.).
if (typeof window !== "undefined" && !configCache) {
  const inline = readInlineBootstrap();
  if (inline) {
    configCache = inline.config;
    if (inline.policy && typeof inline.policy === "object") {
      // Hydrate the policy store from the same payload — saves a second
      // RTT to /api/admin/policy that was previously chained off the
      // config fetch.
      usePolicyStore.setState({
        policy: inline.policy as SettingsPolicy,
        loaded: true,
      });
    }
  }
}

export async function fetchConfig(): Promise<ConfigData> {
  if (configCache) return configCache;
  if (configPromise) return configPromise;

  configPromise = apiFetch('/api/config')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json();
    })
    .then((data) => {
      configCache = data;
      // Fetch admin policy alongside config (non-blocking).
      usePolicyStore.getState().fetchPolicy();
      return data;
    })
    .finally(() => {
      configPromise = null;
    });

  return configPromise;
}

/**
 * Hook to fetch runtime configuration.
 *
 * In the normal cold-load flow, the SSR-inlined bootstrap script populates
 * `configCache` at module load — so useState's initializer already has the
 * full config and no network roundtrip is needed. The fetch fallback only
 * triggers when the inline script is missing (admin pages without the
 * shared layout, tests, error pages).
 */
export function useConfig(): AppConfig {
  const [config, setConfig] = useState<AppConfig>(() =>
    appConfigFrom(configCache, !configCache, null),
  );

  useEffect(() => {
    if (configCache) {
      // useState's initializer already read configCache; we only need to
      // re-set if the cache was populated AFTER our mount (another
      // component triggered fetchConfig in parallel). isLoading is the
      // marker: true ⇒ initializer didn't have cache yet.
      if (config.isLoading) {
        setConfig(appConfigFrom(configCache, false, null));
      }
      return;
    }

    fetchConfig()
      .then((data) => setConfig(appConfigFrom(data, false, null)))
      .catch((err) => {
        setConfig((prev) => ({ ...prev, isLoading: false, error: err.message }));
      });
    // The cache and fetch helpers are module-level singletons; we only
    // want this to run on mount, never on config-state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return config;
}
