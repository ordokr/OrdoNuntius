# Defer auth-store deps (JMAPClient + account-state-manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `lib/jmap/client.ts` (5841 LOC, ~167K minified) and `lib/account-state-manager.ts` (which transitively pulls calendar-store, contact-store, smime-store, filter-store, identity-store, vacation-store, email-store) out of every authenticated route's cold-load bundle, with **zero behavioral risk to logout / logoutAll / switchAccount / persist rehydration**.

**Architecture:** Add a module-level lazy-cache pair in `stores/auth-store.ts` for the two modules. Fire-and-forget the dynamic imports at auth-store module load (so chunks fetch in parallel with everything else). Every async action method awaits `ensureLazyAuthDeps()` before its first sync wrapper call — this is the load-before-use guarantee. Sync wrapper functions proxy through the loaded modules; they only execute on logout/logoutAll paths, which by definition fire AFTER an async login that has already awaited the deps. Defensive null-checks log a warning and no-op if a sync wrapper ever finds an unloaded module (impossible in practice).

**Tech Stack:** TypeScript, Zustand persist middleware, Next.js dynamic imports.

**Why this is zero-risk:**
1. The sync logout paths (`logout`, `logoutAll`, `performFullLogout`) can only fire after a user authenticated. Authentication runs through one of the async action methods (`login`, `loginWithOAuth`, `loginWithServerSso`, `loginDemo`, `checkAuth`, `switchAccount`) — all of which `await ensureLazyAuthDeps()` before doing anything else.
2. `ensureLazyAuthDeps()` is also kicked off at module load (fire-and-forget), giving the chunks a head start. By the time the user could click logout, the modules have been resolvable for seconds.
3. The persist middleware (`onRehydrateStorage` is not defined) never calls account-state-manager during rehydration — verified by reading the full `persist({ ..., partialize, ... })` block.
4. Defensive null-check inside sync wrappers logs `debug.error` and returns instead of throwing — even in the theoretical edge case where modules are missing, the user is no worse off than skipping a cleanup step.
5. The existing test suite (`auth-store-logout.test.ts` + `auth-store-sync.test.ts`) is run twice — once before changes (baseline), once after — to prove behavioral parity.

---

## File Structure

**Files modified:**
- `stores/auth-store.ts` — add lazy-cache plumbing, replace static imports of `JMAPClient`/`RateLimitError`/`account-state-manager` with proxy functions, add `await ensureLazyAuthDeps()` to every async action's earliest possible point.

**Files NOT modified:**
- `lib/jmap/client.ts` — stays as-is. Becomes a dynamically-imported chunk.
- `lib/account-state-manager.ts` — stays as-is. Becomes a dynamically-imported chunk.

**Files for verification:**
- `stores/__tests__/auth-store-logout.test.ts` — must still pass.
- `stores/__tests__/auth-store-sync.test.ts` — must still pass.

---

### Task 1: Baseline — confirm current tests pass before any change

**Files:**
- Read: `stores/__tests__/auth-store-logout.test.ts`
- Read: `stores/__tests__/auth-store-sync.test.ts`

- [ ] **Step 1: Run the auth-store test suite as it stands**

Run: `rtk vitest run stores/__tests__/auth-store-logout.test.ts stores/__tests__/auth-store-sync.test.ts`
Expected: `PASS (8) FAIL (0)` (2 in logout file + 6 in sync file).

- [ ] **Step 2: Run typecheck as baseline**

Run: `rtk tsc --noEmit`
Expected: `TypeScript compilation completed` with no errors.

- [ ] **Step 3: Capture top chunk listing as baseline**

Run: `ls -S .next/static/chunks/*.js 2>/dev/null | head -10 | xargs -I{} sh -c 'echo "$(du -h "{}" | cut -f1)  {}"'`

Expected baseline includes a ~167K chunk that is the JMAPClient bundle. Note the file name for after-comparison.

(No commit — baseline only.)

---

### Task 2: Add the lazy-cache plumbing in auth-store.ts

**Files:**
- Modify: `stores/auth-store.ts:1-19` (replace static imports + add lazy plumbing)

- [ ] **Step 1: Replace the static imports of `JMAPClient` + `RateLimitError` + `account-state-manager` with TYPE-only imports**

Find this block at the top of `stores/auth-store.ts` (lines 1–19):

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { JMAPClient, RateLimitError } from '@/lib/jmap/client';
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
import { snapshotAccount, restoreAccount, clearAllStores, evictAccount, evictAll } from '@/lib/account-state-manager';
import type { Identity } from '@/lib/jmap/types';
import { sortIdentities } from '@/lib/identity-sort';
```

Replace with:

```typescript
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
// `ensureLazyAuthDeps()` is awaited at the top of every async action
// (login*, checkAuth, switchAccount, refreshAccessToken). It is also
// fire-and-forget-kicked-off at module load so the chunks land while
// the page is still rendering. Sync entry points (logout, logoutAll,
// performFullLogout) only run AFTER one of those async paths
// authenticated the user, so the modules are guaranteed to be loaded
// by then. The sync proxy functions (snapshotAccount etc.) defensively
// log + no-op if the module reference is somehow null — which is a
// "shouldn't happen" branch covering the impossible case of a logout
// before any login.

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
    debug.error('auth', 'snapshotAccount called before account-state-manager loaded');
    return;
  }
  _asmMod.snapshotAccount(accountId);
}
function restoreAccount(accountId: string): boolean {
  if (!_asmMod) {
    debug.error('auth', 'restoreAccount called before account-state-manager loaded');
    return false;
  }
  return _asmMod.restoreAccount(accountId);
}
function clearAllStores(): void {
  if (!_asmMod) {
    debug.error('auth', 'clearAllStores called before account-state-manager loaded');
    return;
  }
  _asmMod.clearAllStores();
}
function evictAccount(accountId: string): void {
  if (!_asmMod) {
    debug.error('auth', 'evictAccount called before account-state-manager loaded');
    return;
  }
  _asmMod.evictAccount(accountId);
}
function evictAll(): void {
  if (!_asmMod) {
    debug.error('auth', 'evictAll called before account-state-manager loaded');
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
```

- [ ] **Step 2: Run typecheck after the import swap**

Run: `rtk tsc --noEmit`
Expected: many errors at the call sites in auth-store.ts that still reference `new JMAPClient(...)`, `JMAPClient.withBearer(...)`, `instanceof RateLimitError`, and the bare `snapshotAccount` / `restoreAccount` / etc. names. These will all be fixed in the next tasks. **Do not proceed until you've recorded the count** — every error here is a call site that Task 4 needs to update.

Note: the sync proxy functions defined above intentionally have the same names as the previous static imports so most call sites should resolve to the new sync proxies automatically. The only call sites that need explicit changes are `new JMAPClient(...)`, `JMAPClient.withBearer(...)`, and `instanceof RateLimitError`.

(No commit — partial change. The next tasks finish the call-site updates.)

---

### Task 3: Replace every `JMAPClient` and `RateLimitError` type annotation with the renamed `Ctor` aliases

**Files:**
- Modify: `stores/auth-store.ts` — every bare `JMAPClient` or `RateLimitError` used as a TYPE (not a value).

After Task 2, the only `JMAPClient` / `RateLimitError` names imported are renamed to `JMAPClientCtor` / `RateLimitErrorCtor`. The bare names are no longer in scope, so every TYPE annotation that referenced them must be updated. This is unconditional — typecheck will fail until it's done.

- [ ] **Step 1: Find every bare `JMAPClient` type annotation**

Run: `grep -n "JMAPClient[^a-zA-Z_]" stores/auth-store.ts | grep -v "new\|withBearer\|Ctor\|@/lib/jmap"`

This filters out the construction call sites (`new JMAPClient`, `JMAPClient.withBearer`), the already-renamed aliases (`Ctor`), and the import path string. What remains are all the type annotation occurrences.

Expected occurrences (current code, before edits):
- The `Map<string, JMAPClient>` for the `clients` registry.
- The `client: JMAPClient` field in `BearerLoginFinalization`.
- The `getClientForAccount: (accountId: string) => JMAPClient | undefined` field in `AuthState`.
- The `getAllConnectedClients: () => Map<string, JMAPClient>` field in `AuthState`.

- [ ] **Step 2: Replace each occurrence with `JMAPClientCtor`**

Use Edit-tool find-and-replace with `replace_all: true`:

`old_string: ": JMAPClient"`, `new_string: ": JMAPClientCtor"` (whole-pattern match — applies to type-annotation contexts only, since `new JMAPClient(...)` has `new ` before, not `:`).

Then handle the `Map<string, JMAPClient>` occurrences explicitly:

`old_string: "Map<string, JMAPClient>"`, `new_string: "Map<string, JMAPClientCtor>"` with `replace_all: true`.

And the return-type annotations:

`old_string: "=> JMAPClient |"`, `new_string: "=> JMAPClientCtor |"` with `replace_all: true`.

If any other syntactic context needs to be matched, run the grep from Step 1 again to find the remaining occurrences and edit them inline.

- [ ] **Step 3: Find every bare `RateLimitError` type annotation**

Run: `grep -n "RateLimitError[^a-zA-Z_]" stores/auth-store.ts | grep -v "Ctor\|instanceof\|@/lib/jmap"`

This filters out the renamed alias and the `instanceof RateLimitError` checks (which are value uses — they're fixed in Task 4) and the import string.

Expected occurrences: the `error is RateLimitError` predicate in the `isRateLimitError` helper's signature. Task 4 fixes this — it's already noted there.

If grep finds any other `RateLimitError` type annotation occurrences not covered by Task 4, replace them with `RateLimitErrorCtor` here.

- [ ] **Step 4: Re-run typecheck**

Run: `rtk tsc --noEmit 2>&1 | grep "auth-store" | head -20`

Expected: only errors remaining are at `new JMAPClient(...)`, `JMAPClient.withBearer(...)`, and `instanceof RateLimitError` value-position call sites. All type annotation errors should be gone.

(No commit — still partial.)

---

### Task 4: Update every `new JMAPClient` / `JMAPClient.withBearer` / `instanceof RateLimitError` call site

**Files:**
- Modify: `stores/auth-store.ts` — every value-position use of `JMAPClient` and `RateLimitError`.

Line numbers will have shifted after Task 2's edit added ~80 LOC at the top. Don't rely on the original line numbers — use grep to find current locations.

- [ ] **Step 1: Find every `new JMAPClient` / `JMAPClient.withBearer` call site**

Run: `grep -n "new JMAPClient\|JMAPClient\.withBearer" stores/auth-store.ts`

Record the count and line numbers. There should be at least 8 occurrences across the login*, switchAccount, checkAuth, and the other account-restore methods. All must be updated.

- [ ] **Step 2: At every `new JMAPClient(...)` call site, replace with `new (getJMAPClientCtor())(...)`**

Example transformation:

```typescript
// Before (line 436):
const client = new JMAPClient(serverUrl, username, effectivePassword);

// After:
const client = new (getJMAPClientCtor())(serverUrl, username, effectivePassword);
```

Repeat for every `new JMAPClient(...)` occurrence. The wrapping parens around `getJMAPClientCtor()` are required so `new` binds to the returned constructor.

- [ ] **Step 3: At every `JMAPClient.withBearer(...)` call site, replace with `getJMAPClientCtor().withBearer(...)`**

Example:

```typescript
// Before (line 742):
const client = JMAPClient.withBearer(serverUrl, access_token, '', () => refreshFn());

// After:
const client = getJMAPClientCtor().withBearer(serverUrl, access_token, '', () => refreshFn());
```

Repeat for every `JMAPClient.withBearer` occurrence.

- [ ] **Step 4: Update the `isRateLimitError` helper**

Run: `grep -n "function isRateLimitError" stores/auth-store.ts` to find the current line number.

Find this body:

```typescript
function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}
```

Note: the predicate type uses bare `RateLimitError` — Task 3 may have already updated this to `RateLimitErrorCtor`. If so, the body still has `instanceof RateLimitError` which is the value-position use that needs the constructor accessor. Replace the whole function with:

```typescript
function isRateLimitError(error: unknown): error is RateLimitErrorCtor {
  const ctor = getRateLimitErrorCtor();
  return ctor ? error instanceof ctor : false;
}
```

The `getRateLimitErrorCtor()` returns `null` if the module hasn't loaded yet; in that case we return `false` instead of throwing. This is the only sync read of the lazy module that can legally happen on the cold path, because `isRateLimitError` is called inside JMAP call error handlers — but those errors can only be thrown by a JMAPClient instance that already required the module to be loaded. The null branch is purely defensive.

Note: `RateLimitErrorCtor` is a TYPE-only alias of the `RateLimitError` class. In TypeScript a class name in type position refers to the INSTANCE shape, so `error is RateLimitErrorCtor` correctly asserts that `error` is an instance. The runtime `instanceof` check uses the constructor value returned by `getRateLimitErrorCtor()`.

- [ ] **Step 5: Run typecheck**

Run: `rtk tsc --noEmit`
Expected: `TypeScript compilation completed` with no errors.

- [ ] **Step 6: Commit (intermediate checkpoint)**

```bash
rtk git add stores/auth-store.ts
rtk git commit -m "$(cat <<'EOF'
perf(auth-store): defer JMAPClient + account-state-manager via module-level lazy cache

stores/auth-store.ts is loaded eagerly on every authenticated route.
Its two heaviest deps — lib/jmap/client.ts (~5841 LOC / ~167K minified)
and lib/account-state-manager.ts (which transitively pulls calendar /
contact / smime / filter / identity / vacation / email stores) — were
statically imported, putting the entire stack on every authenticated
route's cold-load bundle.

Defer pattern:
- Top-level converted to `import type` for JMAPClient + RateLimitError.
- account-state-manager imports removed entirely.
- Module-level mutable refs (_jmapClientMod, _asmMod) hold the resolved
  modules after a single async load via `ensureLazyAuthDeps()`.
- The loader is fire-and-forget-kicked-off at module load so the chunks
  fetch in parallel with the rest of page rendering.
- Sync wrapper functions (snapshotAccount, restoreAccount, clearAllStores,
  evictAccount, evictAll) proxy through the loaded module. A defensive
  null-check logs debug.error and no-ops if the module ever finds itself
  missing — covers the impossible case of a sync logout firing before
  any async login.
- getJMAPClientCtor() / getRateLimitErrorCtor() accessors return the
  loaded class. All `new JMAPClient(...)`, `JMAPClient.withBearer(...)`,
  and `instanceof RateLimitError` call sites updated to route through
  these accessors.

The next commit wires `await ensureLazyAuthDeps()` into every async
action method so the load-before-use guarantee is provable from the
call graph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Note: the commit is intentionally **without** the `await ensureLazyAuthDeps()` calls yet. The fire-and-forget loader at module init covers us in the meantime — but adding the explicit awaits in the next task closes the proof loop.

---

### Task 5: Add `await ensureLazyAuthDeps()` to every async action

**Files:**
- Modify: `stores/auth-store.ts` — every async action method

The async action methods that need awaits at their top:
- `login`
- `loginWithOAuth`
- `loginWithServerSso`
- `loginDemo`
- `refreshAccessToken`
- `checkAuth`
- `switchAccount`

- [ ] **Step 1: Find every async action method**

Run: `grep -n "^      login\|^      checkAuth\|^      switchAccount\|^      refreshAccessToken" stores/auth-store.ts`

This should list one line for each action, identifying where to insert the await.

- [ ] **Step 2: For each async action, add `await ensureLazyAuthDeps();` as the first line of the body**

Example transformation:

```typescript
// Before (login at line 431):
login: async (serverUrl, username, password, totp, rememberMe) => {
  const effectivePassword = totp ? `${password}$${totp}` : password;
  set({ isLoading: true, error: null, isRateLimited: false, rateLimitUntil: null });

  try {
    const client = new (getJMAPClientCtor())(serverUrl, username, effectivePassword);
    ...
```

```typescript
// After:
login: async (serverUrl, username, password, totp, rememberMe) => {
  await ensureLazyAuthDeps();
  const effectivePassword = totp ? `${password}$${totp}` : password;
  set({ isLoading: true, error: null, isRateLimited: false, rateLimitUntil: null });

  try {
    const client = new (getJMAPClientCtor())(serverUrl, username, effectivePassword);
    ...
```

Repeat for every async action. Place the await BEFORE any `set(...)` or `getState()` call, so failures during the lazy load surface cleanly without partial state mutations.

- [ ] **Step 3: Run typecheck**

Run: `rtk tsc --noEmit`
Expected: `TypeScript compilation completed` with no errors.

- [ ] **Step 4: Run the auth-store test suite**

Run: `rtk vitest run stores/__tests__/auth-store-logout.test.ts stores/__tests__/auth-store-sync.test.ts`
Expected: `PASS (8) FAIL (0)`.

If any test fails, the most likely cause is a sync action calling a sync wrapper before any async action has fired (which means `ensureLazyAuthDeps()` was never awaited). Read the failing test carefully — it should reveal a sync path that's reachable without going through login first. Address it by adding `await ensureLazyAuthDeps()` at the top of any newly-discovered async action, OR by ensuring the test setup primes the lazy cache manually.

- [ ] **Step 5: Commit**

```bash
rtk git add stores/auth-store.ts
rtk git commit -m "$(cat <<'EOF'
perf(auth-store): await ensureLazyAuthDeps() in every async action method

Closes the load-before-use guarantee for the deferred JMAPClient +
account-state-manager modules introduced in the previous commit. Every
async action (login, loginWithOAuth, loginWithServerSso, loginDemo,
refreshAccessToken, checkAuth, switchAccount) now awaits the lazy
loader as the very first statement in its body — so by the time any
`new JMAPClient(...)` or sync wrapper (snapshotAccount, clearAllStores,
etc.) runs, the modules are guaranteed loaded.

Combined with the fire-and-forget kickoff at module load, this makes
the deferred modules virtually always-resolved before any user action
could fire — typical chunk-fetch RTT is sub-100ms, and user clicks
take at least an order of magnitude longer to reach the handler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Manual verification — login + logout flow on dev

**Files:**
- No files modified.

- [ ] **Step 1: Start the dev server**

Run: `rtk npm run dev` (in background or separate terminal)
Expected: server listening on `http://localhost:3000`.

- [ ] **Step 2: Open `http://localhost:3000/en/login` in a browser, log in with a real account**

Open devtools → Network tab → filter "JS". After login completes:
- Find the dynamically-imported chunk for `lib/jmap/client.ts` — it should appear in the network panel as a separate request.
- Find the dynamically-imported chunk for `lib/account-state-manager.ts` — same.

Expected: both chunks visible as standalone fetches AFTER the route's main JS chunk. This is the proof the defer is working.

- [ ] **Step 3: Inside the inbox, click the logout button (sidebar avatar → Sign Out)**

Expected:
- The user is redirected to `/en/login`.
- localStorage `auth-storage` key is removed.
- No console errors.
- No `debug.error('auth', '... called before account-state-manager loaded')` warnings.

- [ ] **Step 4: Log in again, then add a second account via the account-switcher, then switch between them**

Expected:
- Both accounts authenticate.
- Switching between them clears + restores feature stores correctly (e.g., the inbox view updates to show the active account's mailboxes).
- No console errors.

- [ ] **Step 5: Log out of one account while a second account is registered**

Expected:
- The current logout flow keeps the user in-app, switching to the remaining account.
- `clearAllStores` fires (visible in the inbox UI re-rendering) — meaning the sync wrapper proxied through correctly.

- [ ] **Step 6: Stop the dev server**

Press Ctrl-C in the dev-server terminal.

(No commit — manual verification only.)

---

### Task 7: Build, deploy, smoke

**Files:**
- No files modified.

- [ ] **Step 1: Build the production bundle**

Run: `rtk npm run build`
Expected: completes without errors. Note the build's chunk listing — the JMAPClient chunk should be its own file, separate from the auth-store entry.

- [ ] **Step 2: Verify the chunk listing**

Run: `ls -S .next/static/chunks/*.js 2>/dev/null | head -10 | xargs -I{} sh -c 'echo "$(du -h "{}" | cut -f1)  {}"'`

Expected: the ~167K JMAPClient chunk is now in a chunk that is **not** the auth-store/inbox-page eager chunk. Compare against the baseline from Task 1 Step 3 — the auth-store entry chunk should be smaller by approximately the size of the deferred deps.

- [ ] **Step 3: Push the commits**

Run: `rtk git push`
Expected: `ok main`.

- [ ] **Step 4: Deploy to ec2**

Run: `rtk npm run xtask -- deploy email-lab ec2`
Expected: nginx config-test passes; rsync completes.

If the deploy fails with `Connection reset by peer` (intermittent SSH), simply re-run the command — the deploy script is idempotent.

- [ ] **Step 5: Restart the systemd service**

Memory note: `OrdoNuntius deploy MUST be followed by systemctl restart`. Do not skip.

Run: `ssh ec2 'sudo systemctl restart ordonuntius && sleep 3 && sudo systemctl is-active ordonuntius'`
Expected: `active`.

- [ ] **Step 6: Run the 9-endpoint smoke check**

Run:

```bash
for p in '/' '/api/health' '/login' '/setup' '/en' '/en/calendar' '/en/contacts' '/en/files' '/en/settings'; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" "https://webmail.saltnlightllc.com$p")
  echo "$code $p"
done
```

Expected:
```
200 /
200 /api/health
200 /login
307 /setup
200 /en
200 /en/calendar
200 /en/contacts
200 /en/files
200 /en/settings
```

If anything is not green, investigate immediately. The most likely failure mode is one of the routes hitting a code path that calls a sync wrapper before any async action has fired — review the route's component tree for any direct auth-store action calls outside event handlers.

(No commit — smoke verification.)

---

### Task 8: Live UI verification on production

**Files:**
- No files modified.

- [ ] **Step 1: Open `https://webmail.saltnlightllc.com/en/login` in an incognito window**

Open devtools → Network tab. Confirm that on cold-load:
- The route's main JS chunk does NOT contain the JMAPClient class definition (search the chunk's content for `class JMAPClient` — should be 0 matches).
- A separate chunk loads the JMAPClient class — typically with a hash name and ~50–60KB compressed (down from ~167K uncompressed).

- [ ] **Step 2: Log in with the test account**

Expected:
- Login succeeds.
- The JMAPClient chunk is requested as part of the login flow (visible in Network panel).
- The account-state-manager chunk is also requested.

- [ ] **Step 3: Use the app — open an email, click a contact, view the calendar — to verify feature stores work**

Expected: every feature continues to work exactly as it did before. No broken behavior.

- [ ] **Step 4: Log out**

Expected:
- Logout completes.
- Browser is redirected to `/en/login`.
- No console errors.
- No `debug.error('auth', ...)` warnings about modules not being loaded.

(No commit — live verification.)

---

## Rollback plan

If anything goes wrong at any point after the first deploy:

1. **Find the last good commit before the auth-store changes**:
   ```bash
   rtk git log --oneline stores/auth-store.ts | head -10
   ```

2. **Revert the two new commits** (Task 4 and Task 5):
   ```bash
   rtk git revert <task-5-sha>
   rtk git revert <task-4-sha>
   ```
   Note: revert in reverse order (newest first) so each revert applies cleanly.

3. **Push, deploy, restart, smoke** — same as Task 7 Steps 3–6.

This restores the original eager imports without losing any of the OTHER cold-path defer work already shipped.

---

## Why this is zero-risk (recap)

1. **The async-await guarantee.** Every code path that constructs a `JMAPClient` or calls an account-state-manager function reaches its first such call AFTER an `await ensureLazyAuthDeps()`. This is enforced by adding the await at the top of every async action.

2. **The sync logout safety net.** The sync paths (`logout`, `logoutAll`, `performFullLogout`) call account-state-manager via the sync wrapper functions. Those wrappers only fire if `_asmMod` is populated — which it always is, because the user couldn't have logged in (and therefore couldn't be calling logout) without going through an async action first.

3. **The fire-and-forget head start.** `ensureLazyAuthDeps()` is kicked off at auth-store module load, so by the time the user could click logout the modules have been resolvable for seconds. This is belt-and-suspenders alongside the await-based guarantee.

4. **The defensive null branch.** Even in the impossible case where a sync wrapper fires with `_asmMod === null`, the wrapper logs `debug.error` and returns instead of throwing. The worst case is a cleanup step is skipped — the user still ends up at `/en/login` because `redirectToLogin()` doesn't depend on account-state-manager.

5. **The test suite catches regressions.** The existing 8 auth-store tests (logout + sync flows) must continue to pass after each change. Any break is detected before commit.

6. **The 9-endpoint smoke check catches build/route regressions.** Every deploy is followed by the smoke check before declaring the round complete.

7. **The manual UI verification step.** Task 6 (dev) and Task 8 (prod) walk through login → logout → multi-account flows by hand to verify the UX is identical.

Combined, these layers reduce the risk of behavioral regression to effectively zero for the supported flows.
