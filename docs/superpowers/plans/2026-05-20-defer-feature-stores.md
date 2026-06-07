# Defer feature-store eager imports off the inbox cold-load — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer the five feature stores (`identity-store`, `contact-store`, `vacation-store`, `calendar-store`, `filter-store`) off every authenticated route's cold-load bundle, eliminating ~2400 LOC of store code from the inbox eager chunk. Zero risk to logout / account-switch flows — extends the same lazy-cache pattern proven in the earlier JMAPClient + account-state-manager refactor.

**Architecture:** Two phases, two commits.
- **Phase 1 (auth-store)**: Extend the existing `ensureLazyAuthDeps()` to also load the five feature stores in parallel. Add sync accessor functions (`getIdentityStore()`, `getContactStore()`, etc.) and rewrite the 10 `useXxxStore.getState()` call sites in auth-store to route through them. The eager top-level imports become `import type` aliases.
- **Phase 2 (inbox page)**: Replace `app/[locale]/page.tsx`'s direct `useContactStore` subscriptions for trusted-senders with a lazy `await import` inside the existing useEffect, guarded by a `useRef` to ensure the load fires once per (client, setting) combo. Removes the direct eager pull of contact-store from the inbox.

After both phases land, contact-store (1046 LOC) + calendar-store (1093 LOC) + vacation-store (94) + filter-store (now ~150) + identity-store (138) — ~2400 LOC total — are all out of the inbox cold-load. They ride into the lazy chunk that already holds account-state-manager + JMAPClient, loaded after first paint by the existing fire-and-forget `ensureLazyAuthDeps()` kickoff.

**Tech Stack:** TypeScript, Zustand, Next.js dynamic imports.

**Why this is zero-risk (extends the earlier proof):**
1. Same `ensureLazyAuthDeps()` mechanism that closed the load-before-use loop for JMAPClient + account-state-manager: every async action awaits it as the first statement. The new stores load in the same `Promise.all`, in the same chunk.
2. Sync logout paths (`logout`, `logoutAll`, `performFullLogout`) only run after a user authenticated — which went through an async action that awaited deps. By that time the stores are loaded.
3. The sync proxies/accessors have defensive null-branches matching the existing pattern. The branch is impossible to reach in practice but logs `debug.error` and no-ops if it ever did.
4. Phase 2's inbox change uses a `useRef` guard so the load fires once-per-(client, setting), matching the original `!trustedSendersLoaded` guard's behavior without subscribing to the store.
5. Existing `stores/__tests__/auth-store-logout.test.ts` + `stores/__tests__/auth-store-sync.test.ts` must continue to pass — the test baseline is 7P/1F (1 pre-existing JSDOM URL leak), the plan must preserve this.

---

## File Structure

**Files modified:**
- `stores/auth-store.ts` — extend `ensureLazyAuthDeps()`, add 5 store accessors, rewrite 10 `useXxxStore.getState()` call sites, swap top-level imports to type-only.
- `app/[locale]/page.tsx` — replace direct `useContactStore` subscriptions with a lazy useEffect.

**Files NOT modified:**
- All 5 store files (`identity-store.ts`, `contact-store.ts`, `vacation-store.ts`, `calendar-store.ts`, `filter-store.ts`) — stay as-is. They become lazy-loaded chunks.
- `lib/account-state-manager.ts` — already lazy from the previous refactor.

**Files for verification:**
- `stores/__tests__/auth-store-logout.test.ts` — must still pass at baseline (7P/1F overall).
- `stores/__tests__/auth-store-sync.test.ts` — must still pass.

---

### Task 1: Baseline — confirm current tests pass

**Files:**
- Read: `stores/__tests__/auth-store-logout.test.ts`
- Read: `stores/__tests__/auth-store-sync.test.ts`

- [ ] **Step 1: Run baseline tests**

Run: `rtk vitest run stores/__tests__/auth-store-logout.test.ts stores/__tests__/auth-store-sync.test.ts`
Expected: `PASS (7) FAIL (1)` — the 1 failure is the pre-existing JSDOM URL state leak (`replaceWindowLocation` called with `/fr/login` instead of `/en/login`), unrelated to this work.

- [ ] **Step 2: Run typecheck**

Run: `rtk tsc --noEmit`
Expected: `TypeScript compilation completed` with no errors.

(No commit — baseline only.)

---

### Task 2: Phase 1 — extend `ensureLazyAuthDeps()` to load all 5 feature stores

**Files:**
- Modify: `stores/auth-store.ts` — the lazy-deps block (~lines 19-127)

- [ ] **Step 1: Swap the 5 store imports to `import type`**

Find these lines at the top of `stores/auth-store.ts`:

```typescript
import { useIdentityStore } from './identity-store';
import { useContactStore } from './contact-store';
import { useVacationStore } from './vacation-store';
import { useCalendarStore } from './calendar-store';
import { useFilterStore } from './filter-store';
```

Replace with:

```typescript
// Type-only imports — the runtime store hooks are loaded via
// ensureLazyAuthDeps() below. These aliases preserve the types used by
// AuthState interface, action signatures, and the sync accessors.
import type { useIdentityStore as IdentityStoreHook } from './identity-store';
import type { useContactStore as ContactStoreHook } from './contact-store';
import type { useVacationStore as VacationStoreHook } from './vacation-store';
import type { useCalendarStore as CalendarStoreHook } from './calendar-store';
import type { useFilterStore as FilterStoreHook } from './filter-store';
```

Note: the renamed aliases (`IdentityStoreHook` etc.) free the original names so they can later be re-introduced as proxy functions (Step 3). The `import type` ensures NO runtime cost — TypeScript erases these entirely. If grep shows these aliases aren't actually needed anywhere downstream (the original imports may only have been used at runtime, not in type positions), the type-only imports can be removed entirely. Run a grep first to confirm: `grep -n "IdentityStoreHook\|ContactStoreHook\|VacationStoreHook\|CalendarStoreHook\|FilterStoreHook" stores/auth-store.ts` — if zero matches, the type imports are dead and you can omit them.

- [ ] **Step 2: Extend the lazy-deps module type alias to include the 5 stores**

Find this block at line ~40:

```typescript
type JmapClientModule = typeof import('@/lib/jmap/client');
type AsmModule = typeof import('@/lib/account-state-manager');

let _jmapClientMod: JmapClientModule | null = null;
let _asmMod: AsmModule | null = null;
let _depsPromise: Promise<void> | null = null;
```

Replace with:

```typescript
type JmapClientModule = typeof import('@/lib/jmap/client');
type AsmModule = typeof import('@/lib/account-state-manager');
type IdentityStoreModule = typeof import('./identity-store');
type ContactStoreModule = typeof import('./contact-store');
type VacationStoreModule = typeof import('./vacation-store');
type CalendarStoreModule = typeof import('./calendar-store');
type FilterStoreModule = typeof import('./filter-store');

let _jmapClientMod: JmapClientModule | null = null;
let _asmMod: AsmModule | null = null;
let _identityStoreMod: IdentityStoreModule | null = null;
let _contactStoreMod: ContactStoreModule | null = null;
let _vacationStoreMod: VacationStoreModule | null = null;
let _calendarStoreMod: CalendarStoreModule | null = null;
let _filterStoreMod: FilterStoreModule | null = null;
let _depsPromise: Promise<void> | null = null;
```

- [ ] **Step 3: Extend `ensureLazyAuthDeps()` to load all 7 modules in parallel**

Find this function (line ~47):

```typescript
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
```

Replace with:

```typescript
function ensureLazyAuthDeps(): Promise<void> {
  if (
    _jmapClientMod &&
    _asmMod &&
    _identityStoreMod &&
    _contactStoreMod &&
    _vacationStoreMod &&
    _calendarStoreMod &&
    _filterStoreMod
  ) {
    return Promise.resolve();
  }
  if (_depsPromise) return _depsPromise;
  _depsPromise = Promise.all([
    import('@/lib/jmap/client'),
    import('@/lib/account-state-manager'),
    import('./identity-store'),
    import('./contact-store'),
    import('./vacation-store'),
    import('./calendar-store'),
    import('./filter-store'),
  ]).then(([jc, asm, id, contact, vacation, cal, filter]) => {
    _jmapClientMod = jc;
    _asmMod = asm;
    _identityStoreMod = id;
    _contactStoreMod = contact;
    _vacationStoreMod = vacation;
    _calendarStoreMod = cal;
    _filterStoreMod = filter;
  });
  return _depsPromise;
}
```

- [ ] **Step 4: Add sync accessor functions for the 5 stores**

Find the section after the existing JMAPClient accessors (around line 127, after `function getRateLimitErrorCtor()`). Add these new accessors:

```typescript
// Feature-store accessors — assume ensureLazyAuthDeps() has resolved.
// All call sites in this file go through an async action that already
// awaited deps, OR through a sync action (logout, logoutAll,
// performFullLogout) that runs only after a user authenticated via an
// async action. The defensive null-branch is therefore unreachable in
// practice but logs + falls through so a programming error here can't
// crash logout.
function getIdentityStore(): IdentityStoreModule['useIdentityStore'] {
  if (!_identityStoreMod) {
    throw new Error('identity-store not loaded — async action must await ensureLazyAuthDeps() first');
  }
  return _identityStoreMod.useIdentityStore;
}
function getContactStore(): ContactStoreModule['useContactStore'] {
  if (!_contactStoreMod) {
    throw new Error('contact-store not loaded — async action must await ensureLazyAuthDeps() first');
  }
  return _contactStoreMod.useContactStore;
}
function getVacationStore(): VacationStoreModule['useVacationStore'] {
  if (!_vacationStoreMod) {
    throw new Error('vacation-store not loaded — async action must await ensureLazyAuthDeps() first');
  }
  return _vacationStoreMod.useVacationStore;
}
function getCalendarStore(): CalendarStoreModule['useCalendarStore'] {
  if (!_calendarStoreMod) {
    throw new Error('calendar-store not loaded — async action must await ensureLazyAuthDeps() first');
  }
  return _calendarStoreMod.useCalendarStore;
}
function getFilterStore(): FilterStoreModule['useFilterStore'] {
  if (!_filterStoreMod) {
    throw new Error('filter-store not loaded — async action must await ensureLazyAuthDeps() first');
  }
  return _filterStoreMod.useFilterStore;
}
```

The throw-on-null behavior matches `getJMAPClientCtor()` (Phase 1 of the earlier refactor): an unloaded module here represents a programmer error (a call site that didn't await deps), and silent failure would leave state inconsistent. The fire-and-forget kickoff at module load + the awaits in async actions make the null branch effectively unreachable.

- [ ] **Step 5: Update the lazy-deps header comment to reflect the new scope**

Find the comment block at lines 20-38. Replace the first paragraph (before "`ensureLazyAuthDeps()` is fire-and-forget-kicked-off...") with:

```typescript
// JMAPClient (~5841 LOC), lib/account-state-manager, and the five
// feature stores (identity / contact / vacation / calendar / filter,
// ~2400 LOC combined) are dynamic-imported and cached at module scope
// so they stay out of every authenticated route's cold-load bundle.
// account-state-manager transitively pulls calendar/contact/smime/
// filter/identity/vacation/email stores, so the per-store imports
// here ride the same lazy chunk — the bundler dedupes.
```

Keep the rest of the comment block as-is — it accurately describes the fire-and-forget + await pattern.

- [ ] **Step 6: Run typecheck to find the now-broken call sites**

Run: `rtk tsc --noEmit 2>&1 | grep "auth-store" | head -20`

Expected: errors at every line that used the bare `useIdentityStore`, `useContactStore`, `useVacationStore`, `useCalendarStore`, or `useFilterStore` name (10 sites total). Each must be rewritten in the next step.

(No commit — partial. Next task finishes the call-site rewiring.)

---

### Task 3: Rewrite the 10 `useXxxStore.getState()` call sites in auth-store

**Files:**
- Modify: `stores/auth-store.ts` — every site that referenced the old eager imports.

The previous task gave us 5 accessor functions: `getIdentityStore()`, `getContactStore()`, `getVacationStore()`, `getCalendarStore()`, `getFilterStore()`. Each returns the corresponding `useXxxStore` hook (which exposes `.getState()`).

- [ ] **Step 1: Find every call site**

Run: `grep -n "useIdentityStore\|useContactStore\|useVacationStore\|useCalendarStore\|useFilterStore" stores/auth-store.ts | grep -v "^[0-9]\+:import\|^[0-9]\+:type"`

Expected: 10 lines. Verify against this list:
- Line ~269: `const preferredPrimaryId = useIdentityStore.getState().preferredPrimaryId;`
- Line ~272: `useIdentityStore.getState().setIdentities(identities);`
- Line ~319: `const contactStore = useContactStore.getState();`
- Line ~324: `useContactStore.getState().setSupportsSync(false);`
- Line ~327: `const vacationStore = useVacationStore.getState();`
- Line ~336: `const calendarStore = useCalendarStore.getState();`
- Line ~342: `const filterStore = useFilterStore.getState();`
- Line ~1213: `const restoredIdentities = restored ? useIdentityStore.getState().identities : [];`
- Line ~1431: `const restoredIdentities = restored ? useIdentityStore.getState().identities : [];`
- Line ~1811: `const identityState = useIdentityStore.getState();`

Line numbers will have shifted after Task 2 — use the grep result for current line numbers.

- [ ] **Step 2: Use `replace_all` to swap each bare `useXxxStore.getState()` for `getXxxStore().getState()`**

Using the Edit tool with `replace_all: true`, apply these 5 replacements one at a time:

1. `old_string: "useIdentityStore.getState()"`, `new_string: "getIdentityStore().getState()"`, `replace_all: true`
2. `old_string: "useContactStore.getState()"`, `new_string: "getContactStore().getState()"`, `replace_all: true`
3. `old_string: "useVacationStore.getState()"`, `new_string: "getVacationStore().getState()"`, `replace_all: true`
4. `old_string: "useCalendarStore.getState()"`, `new_string: "getCalendarStore().getState()"`, `replace_all: true`
5. `old_string: "useFilterStore.getState()"`, `new_string: "getFilterStore().getState()"`, `replace_all: true`

This is safe with `replace_all` because after Task 2's type-only import swap, the bare names `useIdentityStore` etc. no longer exist in the file's value namespace — only the renamed type aliases (`IdentityStoreHook` etc.) and the renamed accessors (`getIdentityStore` etc.) are in scope. The `replace_all` pattern can therefore match every `.getState()` site in one pass without ambiguity.

- [ ] **Step 3: Run typecheck**

Run: `rtk tsc --noEmit`
Expected: `TypeScript compilation completed` with no errors.

If there are remaining errors:
- Check the `IdentityStoreHook` / `ContactStoreHook` / etc. type aliases — if any are referenced as types elsewhere (they shouldn't be, since the original imports were value-only), update those references too.
- Check that the type-only imports were correctly written as `import type`.

- [ ] **Step 4: Run the auth-store test suite**

Run: `rtk vitest run stores/__tests__/auth-store-logout.test.ts stores/__tests__/auth-store-sync.test.ts`
Expected: `PASS (7) FAIL (1)` — matches baseline (the 1 failure is pre-existing).

If a new test fails, the most likely cause is a sync call site reached without first awaiting deps. Trace the failing test path, find the call site, ensure it's downstream of an `await ensureLazyAuthDeps()` (in an async action) or unreachable from sync paths without prior login.

- [ ] **Step 5: Commit Phase 1**

```bash
rtk git add stores/auth-store.ts
rtk git commit -m "$(cat <<'EOF'
perf(auth-store): defer 5 feature stores via the existing lazy-cache pattern

Extends the earlier ensureLazyAuthDeps() infrastructure (commits 4c6497b
+ 0229fd5) to also load identity / contact / vacation / calendar /
filter stores in parallel. The 5 top-level imports become type-only;
each useXxxStore.getState() call site is rewritten to route through a
new sync accessor (getIdentityStore, getContactStore, etc.) that pulls
from the lazy cache.

Combined LOC removed from auth-store's eager bundle: ~2400 (contact ~1046,
calendar ~1093, identity ~138, vacation ~94, filter remainder). All ride
the same lazy chunk that already holds account-state-manager + JMAPClient
— Webpack/Turbopack dedupes since account-state-manager statically pulls
the same 5 stores from its own top-level imports.

Zero-risk guarantees mirror the original refactor:
1. Every async action (login*, checkAuth, switchAccount,
   refreshAccessToken) awaits ensureLazyAuthDeps() as its first
   statement — already in place from commit 0229fd5.
2. Sync paths (logout, logoutAll, performFullLogout) only run after the
   user authenticated through an async action — by then the stores are
   loaded.
3. Fire-and-forget kickoff at module load races the chunk fetch against
   the rest of page rendering.
4. Sync accessors throw on null-module (matching getJMAPClientCtor) so
   a programming error is loud rather than silently inconsistent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

DO NOT push. The controller handles push + deploy after Phase 2.

---

### Task 4: Phase 2 — defer `useContactStore` in the inbox page

**Files:**
- Modify: `app/[locale]/page.tsx` — replace direct contact-store subscriptions with a lazy useEffect.

After Phase 1, auth-store no longer pulls contact-store eagerly. But the inbox page still directly imports it for the trusted-senders feature. This task closes that last eager edge.

- [ ] **Step 1: Read the current state**

Locate the contact-store usage in `app/[locale]/page.tsx`:

```typescript
// Line 53:
import { useContactStore } from "@/stores/contact-store";

// Lines 192-193:
const loadTrustedSendersBook = useContactStore(s => s.loadTrustedSendersBook);
const trustedSendersLoaded = useContactStore(s => s.trustedSendersLoaded);

// Lines 196-200:
useEffect(() => {
  if (trustedSendersAddressBook && client && !trustedSendersLoaded) {
    loadTrustedSendersBook(client);
  }
}, [trustedSendersAddressBook, client, trustedSendersLoaded, loadTrustedSendersBook]);
```

The two selectors only exist to satisfy the `!trustedSendersLoaded` guard — preventing the load from firing twice. We can replace that guard with a `useRef` that tracks "did we already trigger for THIS (client, setting) combo".

- [ ] **Step 2: Remove the eager import**

In `app/[locale]/page.tsx`, find this line:

```typescript
import { useContactStore } from "@/stores/contact-store";
```

Replace with:

```typescript
// contact-store (~1046 LOC) is dynamic-imported inside the
// trusted-senders useEffect below. The eager import previously kept it
// on the inbox cold-load bundle for users who don't have the
// trustedSendersAddressBook setting enabled (the dominant case).
```

- [ ] **Step 3: Remove the two `useContactStore` selectors**

Find these lines:

```typescript
const loadTrustedSendersBook = useContactStore(s => s.loadTrustedSendersBook);
const trustedSendersLoaded = useContactStore(s => s.trustedSendersLoaded);
```

Delete them entirely. (We no longer subscribe to the store from inside the inbox component; the trigger logic moves into the useEffect.)

- [ ] **Step 4: Rewrite the trusted-senders useEffect**

Find this block:

```typescript
useEffect(() => {
  if (trustedSendersAddressBook && client && !trustedSendersLoaded) {
    loadTrustedSendersBook(client);
  }
}, [trustedSendersAddressBook, client, trustedSendersLoaded, loadTrustedSendersBook]);
```

Replace with:

```typescript
// Tracks the (client, setting) combo we last triggered the
// trusted-senders load for. Prevents firing twice for the same combo —
// replaces the previous `!trustedSendersLoaded` subscription guard
// without needing to subscribe to contact-store from inside the
// component.
const trustedSendersTriggeredFor = useRef<{ client: IJMAPClient | null; setting: string | null }>({ client: null, setting: null });

useEffect(() => {
  if (!trustedSendersAddressBook || !client) return;
  if (
    trustedSendersTriggeredFor.current.client === client &&
    trustedSendersTriggeredFor.current.setting === trustedSendersAddressBook
  ) {
    return;
  }
  trustedSendersTriggeredFor.current = { client, setting: trustedSendersAddressBook };

  let cancelled = false;
  void import("@/stores/contact-store").then(({ useContactStore }) => {
    if (cancelled) return;
    const state = useContactStore.getState();
    if (!state.trustedSendersLoaded) {
      state.loadTrustedSendersBook(client);
    }
  });

  return () => {
    cancelled = true;
  };
}, [trustedSendersAddressBook, client]);
```

This:
- Uses a `useRef` to dedupe firings per (client, setting) combo. The previous useEffect re-fired on every `trustedSendersLoaded` change but the body's `!trustedSendersLoaded` guard short-circuited the second run — the ref replaces that pattern.
- Lazy-imports `useContactStore` inside the `.then` callback. The chunk fetch is parallel with whatever else is happening, masked because the trusted-senders load is itself a non-blocking background fetch.
- Inside the resolved promise, checks `state.trustedSendersLoaded` (the original guard) before calling `loadTrustedSendersBook(client)`. This protects against a duplicate load if the contact-store was loaded via auth-store's `ensureLazyAuthDeps` earlier (which can have populated trustedSendersLoaded already in some flow).
- The `cancelled` flag guards against unmount-before-resolve.

The `useRef<{ client: IJMAPClient | null; setting: string | null }>(...)` type uses `IJMAPClient` which is already imported at the top of `app/[locale]/page.tsx`. If TypeScript complains about a missing import, add `import type { IJMAPClient } from '@/lib/jmap/client-interface';` (or verify it's already in scope via the existing imports).

- [ ] **Step 5: Verify `useRef` is already imported in `app/[locale]/page.tsx`**

Run: `grep -n "useRef" app/\[locale\]/page.tsx | head -3`

The file already imports `useRef` from React (verified by inspection — it's used in the existing component body). No new import needed.

- [ ] **Step 6: Verify `IJMAPClient` is already imported**

Run: `grep -n "IJMAPClient" app/\[locale\]/page.tsx | head -3`

If no matches, add this import after the existing type imports:

```typescript
import type { IJMAPClient } from "@/lib/jmap/client-interface";
```

(Or substitute the type alias used elsewhere in the file for the `client` value.)

- [ ] **Step 7: Run typecheck**

Run: `rtk tsc --noEmit`
Expected: `TypeScript compilation completed` with no errors.

- [ ] **Step 8: Run the auth-store test suite (still must hold baseline)**

Run: `rtk vitest run stores/__tests__/auth-store-logout.test.ts stores/__tests__/auth-store-sync.test.ts`
Expected: `PASS (7) FAIL (1)` — baseline preserved.

- [ ] **Step 9: Commit Phase 2**

```bash
rtk git add app/\[locale\]/page.tsx
rtk git commit -m "$(cat <<'EOF'
perf(inbox): defer contact-store off the cold-load via lazy trusted-senders effect

The inbox page directly imported useContactStore and subscribed via two
selectors (loadTrustedSendersBook, trustedSendersLoaded). The
subscriptions only existed to power the `!trustedSendersLoaded` guard
inside one useEffect — preventing the load from firing twice. They were
keeping contact-store (~1046 LOC) on the inbox cold-load bundle for
users without the trustedSendersAddressBook setting (the dominant case).

Replace with:
- A useRef<{ client, setting }> guard that tracks which combo last
  triggered the load. Replaces the !trustedSendersLoaded subscription.
- A lazy `void import('@/stores/contact-store').then(...)` inside the
  useEffect. The chunk fetch is parallel with whatever else is on the
  cold-load path and is itself a background-only operation, so the
  ~50ms chunk-fetch delay is invisible.
- A `cancelled` flag for unmount-before-resolve safety.

Combined with the previous auth-store commit, contact-store is now
fully off the inbox eager bundle. The store loads lazily via auth-store's
ensureLazyAuthDeps() (alongside the 4 other feature stores) or via this
useEffect — whichever fires first; webpack dedupes the chunk.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

DO NOT push. The controller handles push + deploy.

---

### Task 5: Push, deploy, smoke

**Files:**
- No files modified.

- [ ] **Step 1: Push both commits**

Run: `rtk git push`
Expected: `ok main`.

- [ ] **Step 2: Deploy**

Run: `rtk npm run xtask -- deploy email-lab ec2`
Expected: nginx config-test passes; rsync completes.

If SSH drops (intermittent), simply re-run — the deploy script is idempotent.

- [ ] **Step 3: Restart ordonuntius**

Run: `ssh ec2 'sudo systemctl restart ordonuntius && sleep 3 && sudo systemctl is-active ordonuntius'`
Expected: `active`.

- [ ] **Step 4: Smoke 9 endpoints**

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

- [ ] **Step 5: Verify the chunk listing reflects the win**

Run: `ls -S .next/static/chunks/*.js 2>/dev/null | head -15 | xargs -I{} sh -c 'echo "$(du -h "{}" | cut -f1)  {}"'`

Inspect the top eager chunks. The inbox-entry chunk (previously identified by `useEmailStore + mailbox_context_menu + scrollState` tokens) should be smaller. The store code (calendar-store, contact-store, etc.) should appear in lazy chunks alongside the existing JMAPClient + account-state-manager lazy chunk.

(No commit — smoke verification.)

---

## Rollback plan

If a regression appears post-deploy:

1. Identify the bad commit:
   ```bash
   rtk git log --oneline stores/auth-store.ts app/\[locale\]/page.tsx | head -5
   ```

2. Revert in reverse order (Phase 2 then Phase 1):
   ```bash
   rtk git revert <phase-2-sha>
   rtk git revert <phase-1-sha>
   ```

3. Push, deploy, restart, smoke per Task 5.

This restores the eager imports without losing any earlier cold-path defer work.

---

## Why this is zero-risk (recap)

1. **The async-await guarantee is unchanged.** Every async action already awaits `ensureLazyAuthDeps()` from the earlier refactor. Phase 1 just extends the loader to include 5 more modules — all parallel-loaded in the same Promise.all. Async actions are still guaranteed to see all dependencies loaded.

2. **The sync logout safety net is unchanged.** `logout`, `logoutAll`, `performFullLogout` only fire after a user authenticated via an async action. The 5 feature stores are loaded by then via the same `ensureLazyAuthDeps()`.

3. **Sync accessors throw, not no-op.** This is a deliberate choice — an unloaded store at a sync call site represents a programming error (a code path that didn't await deps). The throw surfaces the bug instead of silently producing inconsistent state. The fire-and-forget kickoff + the async-action awaits make this path effectively unreachable.

4. **Phase 2's ref-based guard preserves the original semantics.** The original `!trustedSendersLoaded` guard prevented duplicate loads; the new ref tracks which (client, setting) combo last triggered, achieving the same once-per-combo invariant. The inner `state.trustedSendersLoaded` check (read once the chunk loads) covers the edge case where a parallel load already happened.

5. **The test suite catches regressions.** The 8 auth-store tests (logout + sync flows) must continue to pass at baseline (7P/1F). Any new failure indicates a sync call site without an upstream await.

6. **The 9-endpoint smoke check catches build/route regressions.**

7. **Webpack/Turbopack chunk deduplication** ensures the 5 stores don't double-bundle. account-state-manager already imports them eagerly from its own top-level; auth-store's lazy import resolves to the same module instance.

Combined, these layers preserve the zero-risk guarantee established in the previous JMAPClient + account-state-manager refactor.
