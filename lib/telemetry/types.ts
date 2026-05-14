// Schema v1 of the anonymous heartbeat.
// OrdoNuntius does NOT phone home: the scheduler is disabled at boot
// (see instrumentation.node.ts) and DEFAULT_ENDPOINT is empty. The types
// and API routes remain so the admin UI can render a "disabled" state.

export type ConsentState = 'pending' | 'on' | 'off';

export type Platform = 'docker' | 'bare' | 'k8s' | 'unknown';
export type OsFamily = 'linux' | 'darwin' | 'windows' | 'unknown';
export type CountBucket = '0' | '1' | '2-5' | '6-10' | '11-50' | '51-200' | '201+';

export interface TelemetryFeatures {
  calendar: boolean;
  contacts: boolean;
  files: boolean;
  extensions: boolean;
  oauth_enabled: boolean;
  smime_enabled: boolean;
}

export interface TelemetryPayload {
  schema: '1';
  instance_id: string;
  ts: string;
  version: string;
  build: string | null;
  platform: Platform;
  node_version: string;
  os_family: OsFamily;
  stalwart_version: string | null;
  features: TelemetryFeatures;
  counts: {
    accounts: CountBucket;
    accounts_active_7d: CountBucket;
    extensions_installed: number;
    themes_installed: number;
  };
  uptime_days: number;
}

export interface TelemetryStateFile {
  consent: ConsentState;
  endpoint: string;
  consentedAt: string | null;
  lastSentAt: string | null;
  nextScheduledAt: string | null;
}

export const DEFAULT_ENDPOINT = '';
