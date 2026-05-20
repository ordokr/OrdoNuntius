import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JMAPClient as JMAPClientCtor, RateLimitError as RateLimitErrorCtor } from '@/lib/jmap/client';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { useIdentityStore } from './identity-store';
import { useContactStore } from './contact-store';
import { useVacationStore } from './vacation-store';
import { useCalendarStore } from './calendar-store';
import { useFilterStore } from './filter-store';
import { useSettingsStore } from './settings-store';
import { useAccountStore } from './account-store';
import { fetchConfig } from '@/hooks/use-config';
import { debug } from '@/lib/debug';
import { generateAccountId } from '@/lib/account-utils';
import { replaceWindowLocation, getPathPrefix, getLocaleFromPath, apiFetch } from '@/lib/browser-navigation';
import { notifyParent } from '@/lib/iframe-bridge';
import type { Identity } from '@/lib/jmap/types';
import { sortIdentities } from '@/lib/identity-sort';

// ─── Lazy deps ─────────────────────────────────────────────────────
//
// JMAPClient (~5841 LOC, ~167K minified) and lib/account-state-manager
// (which transitively pulls calendar/contact/smime/filter/identity/
// vacation/email stores) are dynamic-imported and cached at module
// scope so they stay out of every authenticated route's cold-load.
//
// `ensureLazyAuthDeps()` is fire-and-forget-kicked-off at module load
// so the chunks fetch in parallel with the rest of page rendering.
// A follow-up commit will additionally `await ensureLazyAuthDeps()` at
// the top of every async action (login*, checkAuth, switchAccount,
// refreshAccessToken), closing the load-before-use loop. Sync entry
// points (logout, logoutAll, performFullLogout) only run AFTER one of
// those async paths authenticated the user, so by that time the
// modules will be loaded.
//
// The sync proxy functions (snapshotAccount etc.) defensively log +
// no-op if the module reference is somehow null — covering the
// impossible-in-practice case of a logout before any login.

type JmapClientModule = typeof import('@/lib/jmap/client');
type AsmModule = typeof import('@/lib/account-state-manager');

let _jmapClientMod: JmapClientModule | null = null;
let _asmMod: AsmModule | null = null;
let _depsPromise: Promise<void> | null = null;

function ensureLazyAuthDeps(): Promise<void> {
  if (_jmapClientMod && _asmMod) return Promise.resolve();
  if (_depsPromise) return _depsPromise;
  _depsPromise = Promise.all([
    import('@/lib/jmap/client'),
    import('@/lib/account-state-manager'),
  ]).then(([jc, asm]) => {
    _jmapClientMod = jc;
    _asmMod = asm;
  });
  return _depsPromise;
}

// Kick off the dynamic imports immediately. The auth-store module is
// pulled by every authenticated route, so this fire-and-forget loader
// races against the rest of the page rendering and is almost always
// resolved long before any user interaction.
void ensureLazyAuthDeps().catch((err) => {
  debug.error('Failed to prefetch lazy auth deps:', err);
});

// Sync proxies — wrap the loaded account-state-manager. All call sites
// in this file must be reachable only AFTER an async action awaited
// ensureLazyAuthDeps(); the null-branch is defensive and shouldn't
// fire in practice.
function snapshotAccount(accountId: string): void {
  if (!_asmMod) {
    debug.error('snapshotAccount called before account-state-manager loaded');
    return;
  }
  _asmMod.snapshotAccount(accountId);
}
function restoreAccount(accountId: string): boolean {
  if (!_asmMod) {
    debug.error('restoreAccount called before account-state-manager loaded');
    return false;
  }
  return _asmMod.restoreAccount(accountId);
}
function clearAllStores(): void {
  if (!_asmMod) {
    debug.error('clearAllStores called before account-state-manager loaded');
    return;
  }
  _asmMod.clearAllStores();
}
function evictAccount(accountId: string): void {
  if (!_asmMod) {
    debug.error('evictAccount called before account-state-manager loaded');
    return;
  }
  _asmMod.evictAccount(accountId);
}
function evictAll(): void {
  if (!_asmMod) {
    debug.error('evictAll called before account-state-manager loaded');
    return;
  }
  _asmMod.evictAll();
}

// JMAPClient + RateLimitError accessors — assume ensureLazyAuthDeps()
// has resolved by the time these are read. All construction call sites
// are inside async action methods that already await deps.
//
// Note on types: the `import type { JMAPClient as JMAPClientCtor }`
// alias above brings in the INSTANCE type (a TypeScript class name
// in type position refers to the instance shape). We can't write
// `typeof JMAPClientCtor` because the alias is type-only — there is
// no value with that name to take `typeof` of. Use the
// `JmapClientModule['JMAPClient']` indexed-access type instead, which
// references the module's exported value (the constructor) directly.
function getJMAPClientCtor(): JmapClientModule['JMAPClient'] {
  if (!_jmapClientMod) {
    throw new Error('JMAPClient module not loaded — async action must await ensureLazyAuthDeps() first');
  }
  return _jmapClientMod.JMAPClient;
}
function getRateLimitErrorCtor(): JmapClientModule['RateLimitError'] | null {
  return _jmapClientMod?.RateLimitError ?? null;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  isRateLimited: boolean;
  rateLimitUntil: number | null;
  serverUrl: string | null;
  username: string | null;
  client: IJMAPClient | null;
  identities: Identity[];
  primaryIdentity: Identity | null;
  authMode: 'basic' | 'oauth';
  rememberMe: boolean;
  accessToken: string | null;
  tokenExpiresAt: number | null;
  connectionLost: boolean;
  activeAccountId: string | null;
  isDemoMode: boolean;

  login: (serverUrl: string, username: string, password: string, totp?: string, rememberMe?: boolean) => Promise<boolean>;
  loginWithOAuth: (serverUrl: string, code: string, codeVerifier: string, redirectUri: string, serverId?: string) => Promise<boolean>;
  loginWithServerSso: (code: string, state: string) => Promise<boolean>;
  loginDemo: () => Promise<boolean>;
  /**
   * Refresh the OAuth access token for an account. When `forAccountId` is
   * omitted, refreshes the currently active account; when provided, refreshes
   * THAT account regardless of which one is currently active. The optional
   * arg is what makes scheduled timers safe across account switches —
   * without it, a timer scheduled for account A but firing after the user
   * switched to B would refresh B's token instead.
   */
  refreshAccessToken: (forAccountId?: string) => Promise<string | null>;
  logout: () => void;
  logoutAll: () => void;
  switchAccount: (accountId: string) => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  syncIdentities: () => void;
  refreshIdentities: () => Promise<void>;
  getClientForAccount: (accountId: string) => JMAPClientCtor | undefined;
  getAllConnectedClients: () => Map<string, JMAPClientCtor>;
}

const ERROR_PATTERNS: Array<{ key: string; matches: string[] }> = [
  { key: 'cors_blocked', matches: ['CORS_ERROR'] },
  { key: 'totp_required', matches: ['TOTP_REQUIRED'] },
  { key: 'invalid_credentials', matches: ['Invalid username or password', '401', 'Unauthorized'] },
  { key: 'connection_failed', matches: ['network', 'Failed to fetch', 'NetworkError', 'ECONNREFUSED', 'Load failed', 'cancelled'] },
  { key: 'server_error', matches: ['500', '502', '503', '504', 'Internal Server Error', 'Service Unavailable'] },
];

function classifyLoginError(error: unknown): string {
  if (!(error instanceof Error)) return 'generic';
  const msg = error.message;
  for (const { key, matches } of ERROR_PATTERNS) {
    if (matches.some((pattern) => msg.includes(pattern))) return key;
  }
  return 'generic';
}

function isRateLimitError(error: unknown): error is RateLimitErrorCtor {
  const ctor = getRateLimitErrorCtor();
  return ctor ? error instanceof ctor : false;
}

function getClientRateLimitState(client: IJMAPClient | null): Pick<AuthState, 'isRateLimited' | 'rateLimitUntil'> {
  if (!client) {
    return { isRateLimited: false, rateLimitUntil: null };
  }

  const remainingMs = client.getRateLimitRemainingMs();
  if (remainingMs <= 0) {
    return { isRateLimited: false, rateLimitUntil: null };
  }

  return {
    isRateLimited: true,
    rateLimitUntil: Date.now() + remainingMs,
  };
}

async function syncStalwartAuthContext(
  serverUrl: string,
  username: string,
  authHeader: string,
  slot: number,
): Promise<void> {
  try {
    const response = await apiFetch('/api/auth/stalwart-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, username, authHeader, slot }),
    });

    if (!response.ok) {
      debug.warn('auth', `Failed to sync Stalwart auth context: ${response.status}`);
    }
  } catch (error) {
    debug.warn('auth', 'Failed to sync Stalwart auth context:', error);
  }
}

function bindClientStatusHandlers(
  client: IJMAPClient,
  set: (state: Partial<AuthState>) => void,
  get: () => AuthState,
  accountId?: string,
): void {
  client.onConnectionChange((connected) => {
    if (!accountId || get().activeAccountId === accountId) {
      set({ connectionLost: !connected });
    }
    if (accountId) {
      useAccountStore.getState().updateAccount(accountId, { isConnected: connected });
    }
  });

  client.onRateLimit((rateLimited, retryAfterMs) => {
    const isActiveAccount = !accountId || get().activeAccountId === accountId;
    const nextRateLimitUntil = rateLimited ? Date.now() + retryAfterMs : null;

    if (isActiveAccount) {
      set({
        isRateLimited: rateLimited,
        rateLimitUntil: nextRateLimitUntil,
        connectionLost: false,
      });
    }

    if (accountId) {
      useAccountStore.getState().updateAccount(accountId, {
        isConnected: !rateLimited,
        hasError: rateLimited,
        errorMessage: rateLimited ? 'Temporarily rate limited by server' : undefined,
      });
    }
  });
}

function loadIdentities(rawIdentities: Identity[], username: string): { identities: Identity[]; primaryIdentity: Identity | null } {
  const preferredPrimaryId = useIdentityStore.getState().preferredPrimaryId;
  const identities = sortIdentities(rawIdentities, username, preferredPrimaryId);
  const primaryIdentity = identities[0] ?? null;
  useIdentityStore.getState().setIdentities(identities);
  return { identities, primaryIdentity };
}

function getLocaleLoginPath(): string {
  if (typeof window === 'undefined') return '/en/login';

  const prefix = getPathPrefix();
  const locale = getLocaleFromPath();
  return `${prefix}/${locale}/login`;
}

function saveRedirectAfterLogin(): void {
  if (typeof window === 'undefined') return;

  try {
    const loginPath = getLocaleLoginPath();
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (currentPath !== loginPath) {
      sessionStorage.setItem('redirect_after_login', currentPath);
    }
  } catch {
    /* noop */
  }
}

export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;

  const loginPath = getLocaleLoginPath();
  if (window.location.pathname === loginPath) return;
  replaceWindowLocation(loginPath);
}

function markSessionExpired(): void {
  try {
    sessionStorage.setItem('session_expired', 'true');
  } catch {
    /* noop */
  }

  saveRedirectAfterLogin();
}

function initializeFeatureStores(client: IJMAPClient): void {
  if (client.supportsContacts()) {
    const contactStore = useContactStore.getState();
    contactStore.setSupportsSync(true);
    contactStore.fetchAddressBooks(client).catch((err) => debug.error('Failed to fetch address books:', err));
    contactStore.fetchContacts(client).catch((err) => debug.error('Failed to fetch contacts:', err));
  } else {
    useContactStore.getState().setSupportsSync(false);
  }

  const vacationStore = useVacationStore.getState();
  if (client.supportsVacationResponse()) {
    vacationStore.setSupported(true);
    vacationStore.fetchVacationResponse(client).catch((err) => debug.error('Failed to fetch vacation response:', err));
  } else {
    vacationStore.setSupported(false);
  }

  if (client.supportsCalendars()) {
    const calendarStore = useCalendarStore.getState();
    calendarStore.setSupported(true);
    calendarStore.fetchCalendars(client).catch((err) => debug.error('Failed to fetch calendars:', err));
  }

  if (client.supportsSieve()) {
    const filterStore = useFilterStore.getState();
    filterStore.setSupported(true);
    filterStore.fetchFilters(client).catch((err) => debug.error('Failed to fetch filters:', err));
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<string | null> | null = null;

// Multi-account state: per-account JMAP clients and refresh timers
const clients = new Map<string, JMAPClientCtor>();
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const refreshPromises = new Map<string, Promise<string | null>>();

function scheduleRefresh(
  expiresIn: number,
  refreshFn: (forAccountId?: string) => Promise<string | null>,
  accountId?: string,
): void {
  if (accountId) {
    const existing = refreshTimers.get(accountId);
    if (existing) clearTimeout(existing);
    const refreshAt = Math.max((expiresIn - 60) * 1000, 10_000);
    refreshTimers.set(accountId, setTimeout(() => {
      // Pass accountId explicitly: this timer was scheduled for THIS
      // account, so it must refresh THIS account even if the user has
      // since switched to a different one.
      refreshFn(accountId).catch((err) => {
        debug.error(`Scheduled token refresh failed for ${accountId}:`, err);
      });
    }, refreshAt));
  } else {
    if (refreshTimer) clearTimeout(refreshTimer);
    const refreshAt = Math.max((expiresIn - 60) * 1000, 10_000);
    refreshTimer = setTimeout(() => {
      refreshFn().catch((err) => {
        debug.error('Scheduled token refresh failed:', err);
      });
    }, refreshAt);
  }
}

function clearRefreshTimer(accountId?: string): void {
  if (accountId) {
    const timer = refreshTimers.get(accountId);
    if (timer) {
      clearTimeout(timer);
      refreshTimers.delete(accountId);
    }
    refreshPromises.delete(accountId);
  } else {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    refreshPromise = null;
  }
}

function clearAllRefreshTimers(): void {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  refreshPromise = null;
  for (const timer of refreshTimers.values()) clearTimeout(timer);
  refreshTimers.clear();
  refreshPromises.clear();
}

/**
 * Synchronously clears all auth and feature store state.
 * Called during full logout (no remaining accounts).
 */
function performFullLogout(set: (state: Partial<AuthState>) => void): void {
  useSettingsStore.getState().disableSync();

  set({
    isAuthenticated: false,
    isLoading: false,
    isRateLimited: false,
    rateLimitUntil: null,
    serverUrl: null,
    username: null,
    client: null,
    identities: [],
    primaryIdentity: null,
    authMode: 'basic',
    rememberMe: false,
    accessToken: null,
    tokenExpiresAt: null,
    connectionLost: false,
    error: null,
    activeAccountId: null,
    isDemoMode: false,
  });

  clearAllStores();

  // Remove persisted state AFTER the final set() so the persist middleware
  // doesn't re-write stale values.
  try { localStorage.removeItem('auth-storage'); } catch { /* noop */ }
  try { localStorage.removeItem('account-storage'); } catch { /* noop */ }
}

interface BearerLoginFinalization {
  /** The connected JMAPClient (already registered in `clients` map). */
  client: JMAPClientCtor;
  /** Account ID — already added to accountStore by the caller. */
  accountId: string;
  username: string;
  serverUrl: string;
  identities: Identity[];
  primaryIdentity: Identity | null;
  accessToken: string;
  expiresIn: number;
  /**
   * Cookie slot the server wrote the refresh-token cookie to. Authoritative
   * over whatever accountStore.addAccount picked, since concurrent tabs can
   * race for slot indices.
   */
  cookieSlot: number;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      /**
       * Shared tail for bearer-token logins (OAuth + server-SSO). Both flows
       * differ in how they obtain the access token but converge on the same
       * post-token bookkeeping: pin the cookie slot, set active, sync
       * Stalwart-context, flip auth state, schedule refresh, notify the
       * embedding parent, kick off settings sync. Was ~60 lines duplicated
       * verbatim in loginWithOAuth and loginWithServerSso.
       */
      const finalizeBearerLogin = async (ctx: BearerLoginFinalization): Promise<void> => {
        const accountStore = useAccountStore.getState();

        // The refresh-token cookie was written to `ctx.cookieSlot`. Force the
        // stored cookieSlot to match: addAccount preserves the prior slot when
        // re-adding an existing account, and recomputes via getNextCookieSlot
        // for new accounts (which may disagree if another tab claimed a slot
        // mid-flow). The cookie's slot is the source of truth.
        accountStore.updateAccount(ctx.accountId, { cookieSlot: ctx.cookieSlot });
        accountStore.setActiveAccount(ctx.accountId);

        await syncStalwartAuthContext(
          ctx.serverUrl,
          ctx.username,
          ctx.client.getAuthHeader(),
          ctx.cookieSlot,
        );

        set({
          isAuthenticated: true,
          isLoading: false,
          serverUrl: ctx.serverUrl,
          username: ctx.username,
          client: ctx.client,
          ...getClientRateLimitState(ctx.client),
          identities: ctx.identities,
          primaryIdentity: ctx.primaryIdentity,
          authMode: 'oauth',
          accessToken: ctx.accessToken,
          tokenExpiresAt: Date.now() + ctx.expiresIn * 1000,
          connectionLost: false,
          error: null,
          activeAccountId: ctx.accountId,
        });

        scheduleRefresh(ctx.expiresIn, get().refreshAccessToken, ctx.accountId);

        notifyParent('sso:auth-success', { username: ctx.username });

        fetchConfig().then((cfg) => {
          if (!cfg.settingsSyncEnabled) return;
          useSettingsStore.getState().loadFromServer(ctx.username, ctx.serverUrl).finally(() => {
            useSettingsStore.getState().enableSync(ctx.username, ctx.serverUrl);
          });
        }).catch(() => {});
      };

      return {
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isRateLimited: false,
      rateLimitUntil: null,
      serverUrl: null,
      username: null,
      client: null,
      identities: [],
      primaryIdentity: null,
      authMode: 'basic',
      rememberMe: false,
      accessToken: null,
      tokenExpiresAt: null,
      connectionLost: false,
      activeAccountId: null,
      isDemoMode: false,

      login: async (serverUrl, username, password, totp, rememberMe) => {
        await ensureLazyAuthDeps();
        const effectivePassword = totp ? `${password}$${totp}` : password;
        set({ isLoading: true, error: null, isRateLimited: false, rateLimitUntil: null });

        try {
          const client = new (getJMAPClientCtor())(serverUrl, username, effectivePassword);
          await client.connect();

          // Inbox emails are the cold-load critical path. Fire the prefetch
          // immediately after connect resolves so Mailbox/get + the
          // speculative-parallel Email/query overlap with identities/
          // stalwart-context/session-write that run below. The email-store
          // promise is coalesced by __prefetchPromise so the later
          // page-mount call is a no-op when this one is still in flight.
          // Dynamic import avoids a static circular dep with email-store.
          const earlyPrefetch = import('@/stores/email-store').then(({ useEmailStore }) => {
            return useEmailStore.getState().prefetchInitialData(client);
          }).catch((err) => {
            debug.error('Early initial data prefetch failed:', err);
          });

          // Resolve account/slot info up front so writes can start immediately.
          const accountStore = useAccountStore.getState();
          const accountId = generateAccountId(username, serverUrl);
          const cookieSlot = accountStore.hasAccount(username, serverUrl)
            ? (accountStore.getAccountById(accountId)?.cookieSlot ?? accountStore.getNextCookieSlot())
            : accountStore.getNextCookieSlot();

          // Snapshot/clear before kicking off any feature-store fetches so they
          // don't write into stores we're about to wipe.
          const prevAccountId = get().activeAccountId;
          if (prevAccountId && prevAccountId !== accountId) {
            snapshotAccount(prevAccountId);
            clearAllStores();
          }

          // Identities can fly in parallel with everything below. JMAPClient
          // captures the auth header per-request, so the optional TOTP upgrade
          // doesn't affect this already-issued request.
          const identitiesPromise = client.getIdentities();

          // When TOTP was used, try to upgrade to token-based auth so the
          // session survives TOTP rotation (basic auth embeds the TOTP in
          // every request, which expires after ~30 seconds). Must complete
          // before stalwart-context reads the auth header.
          let upgradedToOAuth = false;
          let oauthAccessToken: string | null = null;
          let oauthExpiresIn = 0;

          if (totp) {
            try {
              const tokenRes = await apiFetch('/api/auth/totp-token-exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverUrl, username, password: effectivePassword, slot: cookieSlot }),
                // Note: server_id isn't passed here - the route looks up the
                // server entry by serverUrl, so per-server OAuth still applies
                // for password+TOTP logins through the dropdown.
              });
              if (tokenRes.ok) {
                const { access_token, expires_in, has_refresh_token } = await tokenRes.json();
                // Upgrade client to Bearer auth
                client.upgradeToBearer(access_token, () => get().refreshAccessToken());
                oauthAccessToken = access_token;
                oauthExpiresIn = expires_in;
                upgradedToOAuth = true;
                debug.log('auth', 'TOTP login upgraded to token-based auth (has_refresh_token=' + has_refresh_token + ')');
              } else {
                const errorBody = await tokenRes.json().catch(() => ({ error: 'unknown' }));
                debug.warn('auth', 'TOTP token exchange failed:', tokenRes.status, errorBody);
              }
            } catch (err) {
              debug.warn('auth', 'TOTP token exchange error:', err);
            }

            // If token exchange failed, enable TOTP re-auth prompt so the
            // client can ask for a fresh code on 401 instead of disconnecting.
            if (!upgradedToOAuth) {
              const { useTotpReauthStore } = await import('@/stores/totp-reauth-store');
              client.enableTotpReauth(password, () => useTotpReauthStore.getState().requestTotp());
              debug.log('auth', 'TOTP re-auth enabled - user will be prompted for fresh codes on session expiry');
            }
          }

          const effectiveAuthMode = upgradedToOAuth ? 'oauth' : 'basic';

          // sessionWrite/syncStalwartAuthContext used to be awaited via
          // Promise.all alongside identitiesPromise — that gated isAuthenticated
          // on three RTTs none of which the inbox list actually needs. They're
          // now fire-and-forget: persistence side-effects keep happening, but
          // navigation isn't blocked on them.
          if (rememberMe && !upgradedToOAuth) {
            apiFetch(`/api/auth/session?slot=${cookieSlot}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ serverUrl, username, password: effectivePassword, slot: cookieSlot }),
            }).then((res) => {
              if (!res.ok) debug.error('Failed to store session: server returned', res.status);
            }).catch((err) => debug.error('Failed to store session:', err));
          }
          syncStalwartAuthContext(serverUrl, username, client.getAuthHeader(), cookieSlot)
            .catch((err) => debug.warn('auth', 'stalwart-context failed:', err));

          // Identities populate the auth store asynchronously. Compose/reply
          // UIs (the only consumers) are lazy-loaded and ready by the time
          // the user clicks Compose; the email list itself doesn't need them.
          identitiesPromise
            .then((rawIdentities) => {
              const { identities, primaryIdentity } = loadIdentities(rawIdentities, username);
              set({ identities, primaryIdentity });
              accountStore.updateAccount(accountId, {
                label: primaryIdentity?.name || username,
                displayName: primaryIdentity?.name || username,
                email: primaryIdentity?.email || username,
              });
            })
            .catch((err) => debug.error('Identities fetch failed:', err));

          initializeFeatureStores(client);

          // Store client in multi-account map
          clients.set(accountId, client);
          bindClientStatusHandlers(client, set, get, accountId);

          // Account entry uses the username for label/display until the
          // identitiesPromise above fills in primaryIdentity.name — see the
          // .then() that calls accountStore.updateAccount above.
          accountStore.addAccount({
            label: username,
            serverUrl,
            username,
            authMode: effectiveAuthMode,
            rememberMe: !!rememberMe,
            displayName: username,
            email: username,
            lastLoginAt: Date.now(),
            isConnected: true,
            hasError: false,
            isDefault: accountStore.accounts.length === 0,
          });
          accountStore.setActiveAccount(accountId);

          // Update account entry in case it already existed (addAccount is a no-op for existing accounts)
          accountStore.updateAccount(accountId, {
            authMode: effectiveAuthMode,
            rememberMe: !!rememberMe,
            isConnected: true,
            hasError: false,
            errorMessage: undefined,
            lastLoginAt: Date.now(),
          });

          set({
            isAuthenticated: true,
            isLoading: false,
            serverUrl,
            username,
            client,
            ...getClientRateLimitState(client),
            // identities and primaryIdentity stream in from identitiesPromise
            // above. Default to empty/null so the inbox list (which doesn't
            // need them) can render immediately.
            identities: [],
            primaryIdentity: null,
            authMode: effectiveAuthMode,
            rememberMe: !!rememberMe,
            accessToken: oauthAccessToken,
            tokenExpiresAt: oauthAccessToken ? Date.now() + oauthExpiresIn * 1000 : null,
            connectionLost: false,
            error: null,
            activeAccountId: accountId,
          });

          // Inbox prefetch was already kicked off right after client.connect()
          // above; this awaitless re-attach exists only so an early failure
          // surfaces as a debug.error in the same scope as the rest of the
          // login flow (the early earlyPrefetch already swallowed its own).
          void earlyPrefetch;

          // Schedule token refresh for TOTP-upgraded sessions
          if (upgradedToOAuth && oauthExpiresIn > 0) {
            scheduleRefresh(oauthExpiresIn, get().refreshAccessToken, accountId);
          }

          // Sync settings from server (only if enabled)
          fetchConfig().then(config => {
            if (!config.settingsSyncEnabled) return;
            useSettingsStore.getState().loadFromServer(username, serverUrl).finally(() => {
              useSettingsStore.getState().enableSync(username, serverUrl);
            });
          }).catch(() => {});

          return true;
        } catch (error) {
          debug.error('Login error:', error);
          set({
            isLoading: false,
            error: classifyLoginError(error),
            isAuthenticated: false,
            isRateLimited: false,
            rateLimitUntil: null,
            client: null,
          });
          return false;
        }
      },

      loginDemo: async () => {
        await ensureLazyAuthDeps();
        set({ isLoading: true, error: null, isRateLimited: false, rateLimitUntil: null });
        try {
          // Clear all store data before re-initializing with fresh demo data
          clearAllStores();

          const { DemoJMAPClient } = await import('@/lib/demo/demo-client');
          const client = new DemoJMAPClient();
          await client.connect();

          const username = client.getUsername();
          const { identities, primaryIdentity } = loadIdentities(await client.getIdentities(), username);
          initializeFeatureStores(client);

          // Register a demo account entry so the account-switcher shows
          // proper avatar/name instead of a "?" placeholder.
          const accountStore = useAccountStore.getState();
          const demoAccountId = accountStore.addAccount({
            label: primaryIdentity?.name || 'Demo User',
            serverUrl: 'https://demo.example.com',
            username,
            authMode: 'basic',
            rememberMe: false,
            displayName: primaryIdentity?.name || 'Demo User',
            email: primaryIdentity?.email || username,
            lastLoginAt: Date.now(),
            isConnected: true,
            hasError: false,
            isDefault: true,
          });
          accountStore.setActiveAccount(demoAccountId);

          set({
            isAuthenticated: true,
            isLoading: false,
            serverUrl: 'demo.example.com',
            username,
            client,
            ...getClientRateLimitState(client),
            identities,
            primaryIdentity,
            authMode: 'basic',
            rememberMe: false,
            accessToken: null,
            tokenExpiresAt: null,
            connectionLost: false,
            error: null,
            activeAccountId: demoAccountId,
            isDemoMode: true,
          });
          return true;
        } catch (error) {
          debug.error('Demo login error:', error);
          set({
            isLoading: false,
            error: 'generic',
            isAuthenticated: false,
            isRateLimited: false,
            rateLimitUntil: null,
            client: null,
          });
          return false;
        }
      },

      loginWithOAuth: async (serverUrl, code, codeVerifier, redirectUri, serverId) => {
        await ensureLazyAuthDeps();
        set({ isLoading: true, error: null, isRateLimited: false, rateLimitUntil: null });

        try {
          // Determine slot for this account (use slot from sessionStorage if re-adding).
          // Note: `parseInt(getItem(...) || '0')` collapses "no value set" and
          // "value is 0" into the same case, so the fallback to getNextCookieSlot()
          // never fired for the common "+ Add Account" path - every OAuth account
          // ended up on slot 0 and overwrote earlier accounts' refresh-token cookies.
          // Distinguishing rawSlot === null from a parsed 0 fixes that. The page
          // also writes oauth_cookie_slot before redirecting to the IdP.
          const accountStore = useAccountStore.getState();
          const rawSlot = typeof window !== 'undefined'
            ? sessionStorage.getItem('oauth_cookie_slot')
            : null;
          const pendingSlot = rawSlot !== null ? parseInt(rawSlot, 10) : NaN;
          const slot = !isNaN(pendingSlot) && pendingSlot >= 0 && pendingSlot <= 4
            ? pendingSlot
            : accountStore.getNextCookieSlot();

          const tokenRes = await apiFetch(`/api/auth/token?slot=${slot}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              code_verifier: codeVerifier,
              redirect_uri: redirectUri,
              slot,
              ...(serverId ? { server_id: serverId } : {}),
            }),
          });

          if (!tokenRes.ok) {
            throw new Error('token_exchange_failed');
          }

          const { access_token, expires_in } = await tokenRes.json();

          const refreshFn = get().refreshAccessToken;
          const client = getJMAPClientCtor().withBearer(serverUrl, access_token, '', () => refreshFn());
          await client.connect();

          // Inbox prefetch in parallel with everything below — see comment
          // on the password-login earlyPrefetch for details.
          const earlyPrefetch = import('@/stores/email-store').then(({ useEmailStore }) => {
            return useEmailStore.getState().prefetchInitialData(client);
          }).catch((err) => {
            debug.error('Early initial data prefetch failed (OAuth):', err);
          });

          const jmapUsername = client.getUsername();
          const { identities, primaryIdentity } = loadIdentities(await client.getIdentities(), jmapUsername);
          // For OAuth/OIDC, the JMAP session account name may be the
          // preferred_username claim rather than the real email address.
          // Prefer the email from the primary identity when available.
          const username = primaryIdentity?.email || jmapUsername;
          initializeFeatureStores(client);

          // Register in account store
          const accountId = generateAccountId(username, serverUrl);

          // Snapshot current account if switching away and clear stores so
          // the new account starts with a clean email/contact/calendar state.
          const prevAccountId = get().activeAccountId;
          if (prevAccountId && prevAccountId !== accountId) {
            snapshotAccount(prevAccountId);
            clearAllStores();
          }

          clients.set(accountId, client);
          // Now that accountId is resolved, re-bind the refresh callback
          // so a scheduled refresh (or 401-retry) for THIS account refreshes
          // THIS account — not whichever one happens to be active when the
          // callback fires.
          client.setOnTokenRefresh(() => refreshFn(accountId));
          bindClientStatusHandlers(client, set, get, accountId);

          accountStore.addAccount({
            label: primaryIdentity?.name || username,
            serverUrl,
            username,
            authMode: 'oauth',
            rememberMe: true,
            displayName: primaryIdentity?.name || username,
            email: primaryIdentity?.email || username,
            lastLoginAt: Date.now(),
            isConnected: true,
            hasError: false,
            isDefault: accountStore.accounts.length === 0,
          });

          await finalizeBearerLogin({
            client,
            accountId,
            username,
            serverUrl,
            identities,
            primaryIdentity,
            accessToken: access_token,
            expiresIn: expires_in,
            cookieSlot: slot,
          });

          // Prefetch was kicked off earlier (see earlyPrefetch above); this
          // attach exists only so debug.error in the same scope is consistent.
          void earlyPrefetch;

          // Clean up sessionStorage
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('oauth_cookie_slot');
          }

          return true;
        } catch (error) {
          debug.error('OAuth login error:', error);
          const errorMsg = error instanceof Error ? error.message : 'generic';
          notifyParent('sso:auth-failure', { error: errorMsg });
          set({
            isLoading: false,
            error: errorMsg,
            isAuthenticated: false,
            isRateLimited: false,
            rateLimitUntil: null,
            client: null,
          });
          return false;
        }
      },

      loginWithServerSso: async (code, state) => {
        await ensureLazyAuthDeps();
        set({ isLoading: true, error: null, isRateLimited: false, rateLimitUntil: null });

        try {
          // Server-side SSO: the server holds the PKCE verifier in an encrypted cookie.
          // Pass the next-free cookie slot so /api/auth/sso/complete writes the refresh
          // token to the correct per-account jmap_rt_<slot> cookie. Without this the
          // route hardcoded slot 0, which broke "+ Add Account" by overwriting the
          // first account's refresh-token cookie.
          const accountStore = useAccountStore.getState();
          const slot = accountStore.getNextCookieSlot();

          // SSO token exchange and config fetch are independent — fire both
          // up front and let them resolve in parallel.
          const [ssoRes, config] = await Promise.all([
            apiFetch('/api/auth/sso/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ code, state, slot }),
            }),
            fetchConfig(),
          ]);

          if (!ssoRes.ok) {
            const errorData = await ssoRes.json().catch(() => ({ error: 'token_exchange_failed' }));
            throw new Error(errorData.error || 'token_exchange_failed');
          }

          const { access_token, expires_in } = await ssoRes.json();

          const ssoServerUrl = config.jmapServerUrl;

          if (!ssoServerUrl) {
            throw new Error('Server URL not configured');
          }

          const refreshFn = get().refreshAccessToken;
          const client = getJMAPClientCtor().withBearer(ssoServerUrl, access_token, '', () => refreshFn());
          await client.connect();

          // Inbox prefetch in parallel with everything below — see comment
          // on the password-login earlyPrefetch for details.
          const earlyPrefetch = import('@/stores/email-store').then(({ useEmailStore }) => {
            return useEmailStore.getState().prefetchInitialData(client);
          }).catch((err) => {
            debug.error('Early initial data prefetch failed (SSO):', err);
          });

          const jmapUsername = client.getUsername();
          const { identities, primaryIdentity } = loadIdentities(await client.getIdentities(), jmapUsername);
          // For SSO/OIDC, the JMAP session account name may be the
          // preferred_username claim rather than the real email address.
          // Prefer the email from the primary identity when available.
          const username = primaryIdentity?.email || jmapUsername;
          initializeFeatureStores(client);

          const accountId = generateAccountId(username, ssoServerUrl);

          const prevAccountId = get().activeAccountId;
          if (prevAccountId && prevAccountId !== accountId) {
            snapshotAccount(prevAccountId);
            clearAllStores();
          }

          clients.set(accountId, client);
          // Re-bind refresh callback with the now-known accountId; see
          // matching comment in loginWithOAuth for the race this prevents.
          client.setOnTokenRefresh(() => refreshFn(accountId));
          bindClientStatusHandlers(client, set, get, accountId);

          accountStore.addAccount({
            label: primaryIdentity?.name || username,
            serverUrl: ssoServerUrl,
            username,
            authMode: 'oauth',
            rememberMe: true,
            displayName: primaryIdentity?.name || username,
            email: primaryIdentity?.email || username,
            lastLoginAt: Date.now(),
            isConnected: true,
            hasError: false,
            isDefault: accountStore.accounts.length === 0,
          });

          await finalizeBearerLogin({
            client,
            accountId,
            username,
            serverUrl: ssoServerUrl,
            identities,
            primaryIdentity,
            accessToken: access_token,
            expiresIn: expires_in,
            cookieSlot: slot,
          });

          // Prefetch was kicked off earlier (see earlyPrefetch above).
          void earlyPrefetch;

          return true;
        } catch (error) {
          debug.error('Server SSO login error:', error);
          const errorMsg = error instanceof Error ? error.message : 'generic';
          notifyParent('sso:auth-failure', { error: errorMsg });
          set({
            isLoading: false,
            error: errorMsg,
            isAuthenticated: false,
            isRateLimited: false,
            rateLimitUntil: null,
            client: null,
          });
          return false;
        }
      },

      refreshAccessToken: async (forAccountId?: string) => {
        await ensureLazyAuthDeps();
        // Resolve the target account: explicit param wins, else active.
        // Resolving at call time (vs. read at fire time) is what kills the
        // scheduleRefresh race — a timer scheduled for A but firing after
        // the user switched to B used to refresh B's token because the old
        // closure read `get().activeAccountId` fresh.
        const accountId = forAccountId ?? get().activeAccountId;
        const isActive = accountId !== null && accountId === get().activeAccountId;

        // Coalesce per-account first. The legacy singleton `refreshPromise`
        // used to short-circuit BEFORE the map check, which would hand a
        // caller asking about account B the in-flight promise belonging to
        // account A — leaking A's token to B's client. The singleton path
        // now only fires when there's no accountId at all (rare:
        // pre-login bootstrap).
        if (accountId) {
          const existing = refreshPromises.get(accountId);
          if (existing) return existing;
        } else if (refreshPromise) {
          return refreshPromise;
        }

        const account = accountId ? useAccountStore.getState().getAccountById(accountId) : null;
        const slot = account?.cookieSlot ?? 0;

        const promise = (async () => {
          try {
            const res = await apiFetch(`/api/auth/token?slot=${slot}`, { method: 'PUT' });

            if (!res.ok) {
              // Background refresh for a non-active account: don't tear down
              // the whole session — just mark THAT account as errored. The
              // user is still using a different active account.
              if (!isActive && accountId) {
                useAccountStore.getState().updateAccount(accountId, {
                  isConnected: false,
                  hasError: true,
                  errorMessage: 'Token refresh failed',
                });
                return null;
              }
              notifyParent('sso:session-expired');
              markSessionExpired();
              get().logout();
              return null;
            }

            const { access_token, expires_in } = await res.json();

            // Update the right client. Was `get().client?.updateAccessToken`
            // which always points at the ACTIVE client — if we're refreshing
            // a non-active account, that would write A's new token into B's
            // client. Use the per-account map instead.
            const targetClient = accountId ? clients.get(accountId) : get().client;
            targetClient?.updateAccessToken(access_token);

            if (account) {
              await syncStalwartAuthContext(
                account.serverUrl,
                account.username,
                `Bearer ${access_token}`,
                slot,
              );
            }

            // Store-level accessToken/tokenExpiresAt track the ACTIVE account;
            // only mutate them when this refresh is for the active account.
            if (isActive) {
              set({
                accessToken: access_token,
                tokenExpiresAt: Date.now() + expires_in * 1000,
              });
            }

            scheduleRefresh(expires_in, get().refreshAccessToken, accountId ?? undefined);
            return access_token;
          } catch (error) {
            debug.error('Token refresh failed:', error);
            // Same isolation as the !res.ok branch: don't tear down session
            // if the refresh that failed was for a non-active account.
            if (!isActive && accountId) {
              useAccountStore.getState().updateAccount(accountId, {
                isConnected: false,
                hasError: true,
                errorMessage: error instanceof Error ? error.message : 'Token refresh failed',
              });
              return null;
            }
            notifyParent('sso:session-expired');
            markSessionExpired();
            get().logout();
            return null;
          } finally {
            if (accountId) {
              refreshPromises.delete(accountId);
            } else {
              refreshPromise = null;
            }
          }
        })();

        if (accountId) {
          refreshPromises.set(accountId, promise);
        } else {
          refreshPromise = promise;
        }

        return promise;
      },

      logout: () => {
        const state = get();
        const wasDemoMode = state.isDemoMode;
        const wasOAuth = state.authMode === 'oauth';
        const accountId = state.activeAccountId;
        const accountStore = useAccountStore.getState();
        const account = accountId ? accountStore.getAccountById(accountId) : null;
        const slot = account?.cookieSlot ?? 0;

        // Stop refresh timers immediately
        clearRefreshTimer(accountId ?? undefined);

        // Disconnect and null out the client BEFORE clearing stores so the
        // page doesn't fire data-loading effects with the stale client.
        const oldClient = state.client;
        set({ client: null });
        oldClient?.disconnect();

        // Remove client from multi-account map
        if (accountId) {
          clients.delete(accountId);
          evictAccount(accountId);
          accountStore.removeAccount(accountId);
        }

        useSettingsStore.getState().disableSync();

        // Check if there are remaining accounts to switch to
        const remainingAccounts = accountStore.accounts;

        if (remainingAccounts.length > 0 && !wasDemoMode) {
          // Switch to the next account - this is the one path that stays in-app
          const nextAccount = remainingAccounts[0];
          clearAllStores();

          const nextClient = clients.get(nextAccount.id);
          if (nextClient) {
            const restored = restoreAccount(nextAccount.id);
            accountStore.setActiveAccount(nextAccount.id);

            const restoredIdentities = restored ? useIdentityStore.getState().identities : [];
            const restoredPrimary = restoredIdentities[0] ?? null;

            set({
              isAuthenticated: true,
              isLoading: false,
              serverUrl: nextAccount.serverUrl,
              username: nextAccount.username,
              client: nextClient,
              authMode: nextAccount.authMode,
              rememberMe: nextAccount.rememberMe,
              connectionLost: false,
              error: null,
              activeAccountId: nextAccount.id,
              identities: restoredIdentities,
              primaryIdentity: restoredPrimary,
            });

            if (!restored) {
              initializeFeatureStores(nextClient);
              nextClient.getIdentities().then((rawIds) => {
                const { identities, primaryIdentity } = loadIdentities(rawIds, nextAccount.username);
                set({ identities, primaryIdentity });
              }).catch((err) => debug.error('Failed to load identities after switch:', err));
            }
          } else {
            // Client not in memory - clear everything and redirect.
            // Trying to async-restore during logout caused the original bug.
            debug.error(`Cannot restore next account ${nextAccount.id}, performing full logout`);
            evictAccount(nextAccount.id);
            accountStore.removeAccount(nextAccount.id);
            performFullLogout(set);
          }

          // Background cookie cleanup for the removed account
          apiFetch(`/api/auth/session?slot=${slot}`, { method: 'DELETE', keepalive: true }).catch(() => {});
          if (wasOAuth) {
            apiFetch(`/api/auth/token?slot=${slot}`, { method: 'DELETE', keepalive: true }).catch(() => {});
          }
          return;
        }

        // No accounts remaining (or demo mode) - full logout + redirect
        performFullLogout(set);

        notifyParent('sso:logout');

        // Background cookie/token cleanup - keepalive ensures completion during navigation
        if (!wasDemoMode) {
          apiFetch(`/api/auth/session?slot=${slot}`, { method: 'DELETE', keepalive: true }).catch(() => {});
          if (wasOAuth) {
            apiFetch(`/api/auth/token?slot=${slot}`, { method: 'DELETE', keepalive: true }).catch(() => {});
          }
        }

        // Redirect to login - this is synchronous and happens AFTER all state is cleared
        redirectToLogin();
      },

      logoutAll: () => {
        // Disconnect all clients
        for (const c of clients.values()) {
          c.disconnect();
        }
        clients.clear();
        clearAllRefreshTimers();
        evictAll();

        performFullLogout(set);

        // Clear all accounts from registry
        const accountStore = useAccountStore.getState();
        const allAccounts = [...accountStore.accounts];
        for (const account of allAccounts) {
          accountStore.removeAccount(account.id);
        }

        // Background cookie/token cleanup
        apiFetch('/api/auth/session?all=true', { method: 'DELETE', keepalive: true }).catch(() => {});
        apiFetch('/api/auth/token?all=true', { method: 'DELETE', keepalive: true }).catch(() => {});

        redirectToLogin();
      },

      switchAccount: async (accountId: string) => {
        await ensureLazyAuthDeps();
        const state = get();
        if (state.activeAccountId === accountId) return;

        const accountStore = useAccountStore.getState();
        const targetAccount = accountStore.getAccountById(accountId);
        if (!targetAccount) return;

        // Null out the client immediately so the page doesn't fire data-loading
        // effects with the old client while stores are being cleared.
        set({ isLoading: true, client: null, isRateLimited: false, rateLimitUntil: null });

        // Snapshot current account
        if (state.activeAccountId) {
          snapshotAccount(state.activeAccountId);
        }

        // Clear current stores
        clearAllStores();
        useSettingsStore.getState().disableSync();

        // Get or create client for target account
        let targetClient = clients.get(accountId);
        let targetRestoreRateLimited = false;

        if (!targetClient) {
          // Client not connected - try to restore
          try {
            if (targetAccount.authMode === 'oauth') {
              const res = await apiFetch(`/api/auth/token?slot=${targetAccount.cookieSlot}`, { method: 'PUT' });
              if (res.ok) {
                const { access_token, expires_in } = await res.json();
                const refreshFn = get().refreshAccessToken;
                // Bake accountId into the refresh closure from the start —
                // unlike fresh logins, we already know it here.
                targetClient = getJMAPClientCtor().withBearer(targetAccount.serverUrl, access_token, targetAccount.username, () => refreshFn(accountId));
                bindClientStatusHandlers(targetClient, set, get, accountId);
                await targetClient.connect();
                clients.set(accountId, targetClient);
                scheduleRefresh(expires_in, get().refreshAccessToken, accountId);
                await syncStalwartAuthContext(
                  targetAccount.serverUrl,
                  targetAccount.username,
                  targetClient.getAuthHeader(),
                  targetAccount.cookieSlot,
                );
              }
            } else if (targetAccount.authMode === 'basic' && targetAccount.rememberMe) {
              const res = await apiFetch(`/api/auth/session?slot=${targetAccount.cookieSlot}`, { method: 'PUT' });
              if (res.ok) {
                const { serverUrl, username, password } = await res.json();
                targetClient = new (getJMAPClientCtor())(serverUrl, username, password);
                bindClientStatusHandlers(targetClient, set, get, accountId);
                await targetClient.connect();
                clients.set(accountId, targetClient);
                await syncStalwartAuthContext(serverUrl, username, targetClient.getAuthHeader(), targetAccount.cookieSlot);
              }
            }
          } catch (err) {
            debug.error(`Failed to restore client for ${accountId}:`, err);
            if (isRateLimitError(err)) {
              targetRestoreRateLimited = true;
            }
          }
        }

        if (!targetClient) {
          if (targetRestoreRateLimited) {
            if (state.activeAccountId && state.activeAccountId !== accountId) {
              const prevClient = clients.get(state.activeAccountId);
              const prevAccount = accountStore.getAccountById(state.activeAccountId);
              if (prevClient && prevAccount) {
                restoreAccount(state.activeAccountId);
                accountStore.setActiveAccount(state.activeAccountId);
                set({
                  isLoading: false,
                  serverUrl: prevAccount.serverUrl,
                  username: prevAccount.username,
                  client: prevClient,
                  ...getClientRateLimitState(prevClient),
                  authMode: prevAccount.authMode,
                  rememberMe: prevAccount.rememberMe,
                  connectionLost: false,
                  error: 'connection_failed',
                  activeAccountId: state.activeAccountId,
                });
                return;
              }
            }

            set({ isLoading: false, error: 'connection_failed', isRateLimited: false, rateLimitUntil: null });
            return;
          }

          // Cannot restore - remove the stale account and redirect to login
          evictAccount(accountId);
          accountStore.removeAccount(accountId);
          apiFetch(`/api/auth/session?slot=${targetAccount.cookieSlot}`, { method: 'DELETE' }).catch(() => {});

          // Restore the previous account if still available
          if (state.activeAccountId && state.activeAccountId !== accountId) {
            const prevClient = clients.get(state.activeAccountId);
            const prevAccount = accountStore.getAccountById(state.activeAccountId);
            if (prevClient && prevAccount) {
              restoreAccount(state.activeAccountId);
              accountStore.setActiveAccount(state.activeAccountId);
              set({
                isLoading: false,
                serverUrl: prevAccount.serverUrl,
                username: prevAccount.username,
                client: prevClient,
                ...getClientRateLimitState(prevClient),
                authMode: prevAccount.authMode,
                rememberMe: prevAccount.rememberMe,
                connectionLost: false,
                activeAccountId: state.activeAccountId,
              });
              return;
            }
          }

          set({ isLoading: false });
          // Redirect to login so the user can re-authenticate
          replaceWindowLocation(getLocaleLoginPath());
          return;
        }

        // Restore cached state or fetch fresh
        const restored = restoreAccount(accountId);
        accountStore.setActiveAccount(accountId);
        accountStore.updateAccount(accountId, { isConnected: true, hasError: false, errorMessage: undefined });

        // Build identity state up front so the name updates atomically
        const restoredIdentities = restored ? useIdentityStore.getState().identities : [];
        const restoredPrimary = restoredIdentities[0] ?? null;

        set({
          isAuthenticated: true,
          isLoading: false,
          serverUrl: targetAccount.serverUrl,
          username: targetAccount.username,
          client: targetClient,
          ...getClientRateLimitState(targetClient),
          authMode: targetAccount.authMode,
          rememberMe: targetAccount.rememberMe,
          connectionLost: false,
          error: null,
          activeAccountId: accountId,
          identities: restoredIdentities,
          primaryIdentity: restoredPrimary,
        });

        if (!restored) {
          // Fetch fresh data
          try {
            const { identities, primaryIdentity } = loadIdentities(await targetClient.getIdentities(), targetAccount.username);
            set({ identities, primaryIdentity });
            initializeFeatureStores(targetClient);
          } catch (err) {
            debug.error(`Failed to load data for ${accountId}:`, err);
          }
        }

        // Sync settings
        fetchConfig().then(config => {
          if (!config.settingsSyncEnabled) return;
          useSettingsStore.getState().loadFromServer(targetAccount.username, targetAccount.serverUrl).finally(() => {
            useSettingsStore.getState().enableSync(targetAccount.username, targetAccount.serverUrl);
          });
        }).catch(() => {});
      },

      checkAuth: async () => {
        await ensureLazyAuthDeps();
        const accountStore = useAccountStore.getState();
        const accounts = accountStore.accounts;

        // If the only account is the demo account, re-initialize demo mode
        // instead of trying to restore a server session (which doesn't exist).
        if (accounts.length === 1 && accounts[0].serverUrl === 'https://demo.example.com') {
          await get().loginDemo();
          return;
        }

        // Multi-account restoration: restore all registered accounts
        if (accounts.length > 0) {
          // Null out client so the page doesn't fire data-loading effects
          // with a stale client reference while we're restoring accounts.
          set({ isLoading: true, client: null });

          // Determine which account to activate first
          const defaultAccount = accountStore.getDefaultAccount();
          const activeId = get().activeAccountId;
          const targetId = activeId || defaultAccount?.id || accounts[0].id;

          // Restore accounts in parallel. The previous serial for-loop paid
          // (auth-RTT + JMAP-connect-RTT) sequentially per account — for N
          // accounts that's N× the latency. Promise.all overlaps them; per-
          // account failures stay isolated because each branch swallows its
          // own error and just leaves that account flagged as not-connected.
          await Promise.all(accounts.map(async (account) => {
            if (clients.has(account.id)) return; // Already connected

            // Basic auth without rememberMe leaves nothing to restore - the
            // user logged in without persisting credentials. Evict silently
            // so the login screen is shown without flagging a fake error.
            if (account.authMode === 'basic' && !account.rememberMe) {
              evictAccount(account.id);
              accountStore.removeAccount(account.id);
              return;
            }

            try {
              if (account.authMode === 'oauth') {
                const res = await apiFetch(`/api/auth/token?slot=${account.cookieSlot}`, { method: 'PUT' });
                if (res.ok) {
                  const { access_token, expires_in } = await res.json();
                  const refreshFn = get().refreshAccessToken;
                  // accountId is already known here (account.id) — bake it
                  // into the refresh callback at construction time.
                  const client = getJMAPClientCtor().withBearer(account.serverUrl, access_token, account.username, () => refreshFn(account.id));
                  bindClientStatusHandlers(client, set, get, account.id);
                  await client.connect();
                  clients.set(account.id, client);
                  scheduleRefresh(expires_in, get().refreshAccessToken, account.id);
                  await syncStalwartAuthContext(account.serverUrl, account.username, client.getAuthHeader(), account.cookieSlot);
                  accountStore.updateAccount(account.id, { isConnected: true, hasError: false });
                } else {
                  throw new Error(`Token refresh failed: ${res.status}`);
                }
              } else {
                const res = await apiFetch(`/api/auth/session?slot=${account.cookieSlot}`, { method: 'PUT' });
                if (res.ok) {
                  const { serverUrl, username, password } = await res.json();
                  const client = new (getJMAPClientCtor())(serverUrl, username, password);
                  bindClientStatusHandlers(client, set, get, account.id);
                  await client.connect();
                  clients.set(account.id, client);
                  await syncStalwartAuthContext(serverUrl, username, client.getAuthHeader(), account.cookieSlot);
                  accountStore.updateAccount(account.id, { isConnected: true, hasError: false });
                } else {
                  throw new Error(`Session cookie missing: ${res.status}`);
                }
              }
            } catch (err) {
              debug.error(`Failed to restore account ${account.id}:`, err);
              if (isRateLimitError(err)) {
                accountStore.updateAccount(account.id, {
                  isConnected: false,
                  hasError: true,
                  errorMessage: 'Temporarily rate limited by server',
                });
                return;
              }
              // Remove unrestorable accounts so the user is prompted to log in
              // again rather than seeing a stale error entry forever.
              evictAccount(account.id);
              accountStore.removeAccount(account.id);
              apiFetch(`/api/auth/session?slot=${account.cookieSlot}`, { method: 'DELETE' }).catch(() => {});
            }
          }));

          // Activate the target account
          const targetClient = clients.get(targetId);
          const targetAccount = accountStore.getAccountById(targetId);
          if (targetClient && targetAccount) {
            accountStore.setActiveAccount(targetId);
            const { identities, primaryIdentity } = loadIdentities(await targetClient.getIdentities(), targetAccount.username);
            initializeFeatureStores(targetClient);

            set({
              isAuthenticated: true,
              isLoading: false,
              serverUrl: targetAccount.serverUrl,
              username: targetAccount.username,
              client: targetClient,
              ...getClientRateLimitState(targetClient),
              identities,
              primaryIdentity,
              authMode: targetAccount.authMode,
              rememberMe: targetAccount.rememberMe,
              connectionLost: false,
              error: null,
              activeAccountId: targetId,
            });

            fetchConfig().then(config => {
              if (!config.settingsSyncEnabled) return;
              useSettingsStore.getState().loadFromServer(targetAccount.username, targetAccount.serverUrl).finally(() => {
                useSettingsStore.getState().enableSync(targetAccount.username, targetAccount.serverUrl);
              });
            }).catch(() => {});
            return;
          }

          // If target didn't connect, try any connected account
          for (const [id, client] of clients.entries()) {
            const acc = accountStore.getAccountById(id);
            if (acc) {
              accountStore.setActiveAccount(id);
              const { identities, primaryIdentity } = loadIdentities(await client.getIdentities(), acc.username);
              initializeFeatureStores(client);

              set({
                isAuthenticated: true,
                isLoading: false,
                serverUrl: acc.serverUrl,
                username: acc.username,
                client,
                ...getClientRateLimitState(client),
                identities,
                primaryIdentity,
                authMode: acc.authMode,
                rememberMe: acc.rememberMe,
                connectionLost: false,
                error: null,
                activeAccountId: id,
              });
              return;
            }
          }

          // No accounts could be restored
          if (accounts.some((account) => accountStore.getAccountById(account.id))) {
            set({
              isAuthenticated: false,
              isLoading: false,
              isRateLimited: false,
              rateLimitUntil: null,
              client: null,
              error: 'connection_failed',
            });
            return;
          }

          markSessionExpired();
          set({
            isAuthenticated: false,
            isLoading: false,
            isRateLimited: false,
            rateLimitUntil: null,
            client: null,
            serverUrl: null,
            username: null,
            authMode: 'basic',
            rememberMe: false,
            accessToken: null,
            tokenExpiresAt: null,
            activeAccountId: null,
          });
          return;
        }

        // Legacy single-account fallback (for accounts not yet in registry)
        const state = get();
        if (state.isAuthenticated && !state.client) {
          if (state.authMode === 'oauth' && state.serverUrl) {
            set({ isLoading: true, isRateLimited: false, rateLimitUntil: null });
            try {
              const token = await get().refreshAccessToken();
              if (token && state.serverUrl) {
                const refreshFn = get().refreshAccessToken;
                const client = getJMAPClientCtor().withBearer(state.serverUrl, token, state.username || '', () => refreshFn());
                await client.connect();

                const accountId = generateAccountId(state.username || '', state.serverUrl);
                clients.set(accountId, client);
                // Re-bind once accountId is known.
                client.setOnTokenRefresh(() => refreshFn(accountId));
                bindClientStatusHandlers(client, set, get, accountId);

                // Migrate to account registry
                accountStore.addAccount({
                  label: state.username || '',
                  serverUrl: state.serverUrl,
                  username: state.username || '',
                  authMode: 'oauth',
                  rememberMe: true,
                  displayName: state.username || '',
                  email: state.username || '',
                  lastLoginAt: Date.now(),
                  isConnected: true,
                  hasError: false,
                  isDefault: accountStore.accounts.length === 0,
                });
                accountStore.setActiveAccount(accountId);

                const { identities, primaryIdentity } = loadIdentities(await client.getIdentities(), state.username || '');
                initializeFeatureStores(client);

                set({
                  isAuthenticated: true,
                  isLoading: false,
                  client,
                  ...getClientRateLimitState(client),
                  identities,
                  primaryIdentity,
                  accessToken: token,
                  activeAccountId: accountId,
                });

                fetchConfig().then(config => {
                  if (!config.settingsSyncEnabled) return;
                  useSettingsStore.getState().loadFromServer(state.username || '', state.serverUrl!).finally(() => {
                    useSettingsStore.getState().enableSync(state.username || '', state.serverUrl!);
                  });
                }).catch(() => {});
                return;
              }
            } catch (error) {
              debug.error('OAuth session restore failed:', error);
              if (isRateLimitError(error)) {
                set({ isLoading: false, error: 'connection_failed', isRateLimited: false, rateLimitUntil: null });
                return;
              }
              clearRefreshTimer();
            }
          }

          if (state.authMode === 'basic') {
            set({ isLoading: true, isRateLimited: false, rateLimitUntil: null });
            try {
              const res = await apiFetch('/api/auth/session', { method: 'PUT' });
              if (res.ok) {
                const data = await res.json();
                if (!data.serverUrl || !data.username || !data.password) {
                  debug.error('Session restore returned incomplete data');
                  throw new Error('Incomplete session data');
                }
                const { serverUrl, username, password } = data;
                const client = new (getJMAPClientCtor())(serverUrl, username, password);
                await client.connect();

                const accountId = generateAccountId(username, serverUrl);
                clients.set(accountId, client);
                bindClientStatusHandlers(client, set, get, accountId);

                // Migrate to account registry
                accountStore.addAccount({
                  label: username,
                  serverUrl,
                  username,
                  authMode: 'basic',
                  rememberMe: state.rememberMe,
                  displayName: username,
                  email: username,
                  lastLoginAt: Date.now(),
                  isConnected: true,
                  hasError: false,
                  isDefault: accountStore.accounts.length === 0,
                });
                accountStore.setActiveAccount(accountId);

                const cookieSlot = accountStore.getAccountById(accountId)?.cookieSlot ?? 0;
                await syncStalwartAuthContext(serverUrl, username, client.getAuthHeader(), cookieSlot);

                const { identities, primaryIdentity } = loadIdentities(await client.getIdentities(), username);
                initializeFeatureStores(client);

                set({
                  isAuthenticated: true,
                  isLoading: false,
                  serverUrl,
                  username,
                  client,
                  ...getClientRateLimitState(client),
                  identities,
                  primaryIdentity,
                  authMode: 'basic',
                  activeAccountId: accountId,
                });

                fetchConfig().then(config => {
                  if (!config.settingsSyncEnabled) return;
                  useSettingsStore.getState().loadFromServer(username, serverUrl).finally(() => {
                    useSettingsStore.getState().enableSync(username, serverUrl);
                  });
                }).catch(() => {});
                return;
              }
            } catch (error) {
              debug.error('Basic session restore failed:', error);
              if (isRateLimitError(error)) {
                set({ isLoading: false, error: 'connection_failed', isRateLimited: false, rateLimitUntil: null });
                return;
              }
            }
          }

          markSessionExpired();

          set({
            isAuthenticated: false,
            isLoading: false,
            isRateLimited: false,
            rateLimitUntil: null,
            client: null,
            serverUrl: null,
            username: null,
            authMode: 'basic',
            rememberMe: false,
            accessToken: null,
            tokenExpiresAt: null,
            activeAccountId: null,
          });
        }

        set({ isLoading: false });
      },

      clearError: () => set({ error: null }),

      syncIdentities: () => {
        const identityState = useIdentityStore.getState();
        const identities = identityState.identities;
        const primaryIdentity = identities[0] ?? null;
        set({ identities, primaryIdentity });
      },

      refreshIdentities: async () => {
        const { client, username } = get();
        if (!client || !username) return;
        try {
          const rawIdentities = await client.getIdentities();
          const { identities, primaryIdentity } = loadIdentities(rawIdentities, username);
          set({ identities, primaryIdentity });
        } catch {
          // Silently fail - background sync should not surface errors to the user
        }
      },

      getClientForAccount: (accountId: string) => {
        return clients.get(accountId);
      },

      getAllConnectedClients: () => {
        return new Map(clients);
      },
    };
    },
    {
      name: 'auth-storage',
      partialize: (state) => {
        // Don't persist unauthenticated state - prevents resurrecting stale sessions
        if (!state.isAuthenticated) return {};
        return {
          serverUrl: state.serverUrl,
          username: state.username,
          authMode: state.authMode,
          isAuthenticated: (state.authMode === 'oauth' || state.rememberMe)
            ? state.isAuthenticated
            : undefined,
          rememberMe: state.rememberMe,
          activeAccountId: state.activeAccountId,
        };
      },
    }
  )
);
