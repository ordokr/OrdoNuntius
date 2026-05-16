// Server-side helper that produces the JSON payload inlined into the
// SSR HTML by app/layout.tsx. Eliminates two cold-load network round
// trips: /api/config and /api/admin/policy. Both are sync reads from
// configManager (in-memory after ensureLoaded), so computing them at
// SSR time is essentially free.
//
// The shape MUST match what the existing /api/config and /api/admin/
// policy routes return — use-config.ts and policy-store.ts hydrate
// from this without doing a runtime fetch when the inline payload is
// present.

import { configManager } from "@/lib/admin/config-manager";
import { parseJmapServers, redactJmapServers } from "@/lib/admin/jmap-servers";
import { hasSessionSecret } from "@/lib/auth/session-secret";
import type { SettingsPolicy } from "@/lib/admin/types";

export interface PublicConfigPayload {
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
  allowCustomJmapEndpoint: boolean;
  jmapServers: ReturnType<typeof redactJmapServers>;
  jmapServerAutoPickByDomain: boolean;
  autoSsoEnabled: boolean;
  embeddedMode: boolean;
  parentOrigin: string;
}

export interface BootstrapPayload {
  config: PublicConfigPayload;
  policy: SettingsPolicy;
}

export async function getPublicConfig(): Promise<PublicConfigPayload> {
  await configManager.ensureLoaded();

  const appName =
    configManager.get<string>("appName") ||
    process.env.NEXT_PUBLIC_APP_NAME ||
    "Webmail";
  const jmapServerUrl =
    configManager.get<string>("jmapServerUrl") ||
    process.env.NEXT_PUBLIC_JMAP_SERVER_URL ||
    "";
  const oauthEnabled = configManager.get<boolean>("oauthEnabled", false);
  const oauthOnly = oauthEnabled && configManager.get<boolean>("oauthOnly", false);
  const stalwartFeaturesEnabled = configManager.get<boolean>(
    "stalwartFeaturesEnabled",
    true,
  );
  const allowedFrameAncestors = configManager.get<string>("allowedFrameAncestors", "");

  return {
    appName,
    jmapServerUrl,
    oauthEnabled,
    oauthOnly,
    oauthClientId: configManager.get<string>("oauthClientId", ""),
    oauthIssuerUrl: configManager.get<string>("oauthIssuerUrl", ""),
    rememberMeEnabled: hasSessionSecret(),
    settingsSyncEnabled:
      configManager.get<boolean>("settingsSyncEnabled", false) && hasSessionSecret(),
    stalwartFeaturesEnabled,
    devMode: configManager.get<boolean>("devMode", false),
    faviconUrl: configManager.get<string>(
      "faviconUrl",
      "/branding/OrdoNuntius_Favicon.svg",
    ),
    appLogoLightUrl: configManager.get<string>("appLogoLightUrl", ""),
    appLogoDarkUrl: configManager.get<string>("appLogoDarkUrl", ""),
    loginLogoLightUrl: configManager.get<string>(
      "loginLogoLightUrl",
      "/branding/OrdoNuntius_Logo_Color.svg",
    ),
    loginLogoDarkUrl: configManager.get<string>(
      "loginLogoDarkUrl",
      "/branding/OrdoNuntius_Logo_White.svg",
    ),
    loginCompanyName: configManager.get<string>("loginCompanyName", ""),
    loginImprintUrl: configManager.get<string>("loginImprintUrl", ""),
    loginPrivacyPolicyUrl: configManager.get<string>("loginPrivacyPolicyUrl", ""),
    loginWebsiteUrl: configManager.get<string>("loginWebsiteUrl", ""),
    demoMode: configManager.get<boolean>("demoMode", false),
    allowCustomJmapEndpoint: configManager.get<boolean>("allowCustomJmapEndpoint", false),
    jmapServers: redactJmapServers(parseJmapServers(configManager.get<unknown>("jmapServers", []))),
    jmapServerAutoPickByDomain: configManager.get<boolean>(
      "jmapServerAutoPickByDomain",
      false,
    ),
    autoSsoEnabled: configManager.get<boolean>("autoSsoEnabled", false),
    embeddedMode: !!allowedFrameAncestors && allowedFrameAncestors !== "'none'",
    parentOrigin: configManager.get<string>("parentOrigin", ""),
  };
}

export async function getBootstrapPayload(): Promise<BootstrapPayload> {
  // getPublicConfig already does ensureLoaded; getPolicy then reads the
  // in-memory policyCache so no second I/O. Concurrent SSR renders all
  // share configManager's singleton — first one warms the cache, rest
  // are free.
  const config = await getPublicConfig();
  const policy = configManager.getPolicy();
  return { config, policy };
}

// XSS-safe JSON serialization for embedding inside <script type="application/json">.
// Escaping `<` prevents a `</script>` substring inside any string value from
// closing the wrapping script tag prematurely. JSON has no semantic difference
// between '<' and '<'; the consumer parses with JSON.parse which restores it.
export function serializeForScriptTag(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export const BOOTSTRAP_SCRIPT_ID = "__ORDO_BOOTSTRAP__";
