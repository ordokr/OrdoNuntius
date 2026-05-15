# Runbook — Lessons from the 2026-05-15 launch arc

A single retrospective of issues hit during the OrdoNuntius launch on
`webmail.saltnlightllc.com` and the cumulative state-subscription /
bundle / inbox-load fixes that followed. Each entry is **symptom → root
cause → fix → how to recognize it again**.

Pair this with `launch-checklist.md` for the canonical sequencing and
with `restart-canary-webmail.md` for the post-deploy gate. This doc is
the failure-mode appendix.

---

## A. State-subscription patterns (React + zustand)

### A1. Whole-store destructure invalidates every component on every set()

**Symptom:** every store mutation (selection toggle, scroll position
update, keystroke in a search input) re-rendered the entire mail tree
including the virtualized email list rows. Profiler showed `ThreadListItem`
and `EmailViewer` re-rendering even when nothing they used changed.

**Root cause:** `const { x, y } = useEmailStore()` subscribes to *every*
field because zustand returns a new state object reference on every
`set()`. `Object.is` comparison sees a mismatch → render.

**Fix:** use per-field selectors:

```ts
const x = useEmailStore(s => s.x);   // ✅ subscribes only when x changes
const y = useEmailStore(s => s.y);
// actions are stable function refs — read via getState() inside handlers,
// no subscription needed:
const onClick = () => useEmailStore.getState().toggleEmailSelection(id);
```

For 20+ field destructures where granular selectors would be noisy, use
`useShallow`:

```ts
import { useShallow } from 'zustand/react/shallow';
const { a, b, c, ... } = useEmailStore(useShallow(s => ({
  a: s.a, b: s.b, c: s.c, ...,
})));
```

**Recognize it again:** profile with React DevTools — if a component
re-renders on selection changes but doesn't visibly use selection, it's
oversubscribed. Search the file for `} = useEmailStore()` (no selector
argument).

### A2. Inline callbacks defeat React.memo

**Symptom:** wrapping a virtualized row in `React.memo` had zero effect.
Rows still re-rendered on every parent render.

**Root cause:** parent passes `onClick={() => fn(email)}` — a fresh
function reference each render, so the row's prop comparison always
mismatches.

**Fix:** parent passes the *stable* function; row calls it with the
per-row arg:

```ts
// parent:
<Row onSelect={onEmailSelect} email={email} />

// row:
function RowImpl({ email, onSelect }: Props) {
  const handle = () => onSelect(email);
  ...
}
export const Row = memo(RowImpl);
```

**Recognize it again:** if you wrap something in `memo` and it doesn't
help, audit the JSX for arrow-function props. Either move the closure
out (parent useCallback) or change the signature so the closure isn't
needed.

---

## B. Inbox-load failures and how to recognize them

### B1. Sidebar shows "Inbox 8" but list shows "No messages found"

**Symptom:** post-login the inbox renders empty; clicking the sidebar's
Inbox row populates emails.

**Root cause(s) we found:**
- `fetchMailboxes` auto-select used `m.role === 'inbox'` strict equality.
  Stalwart can return `role` unset or non-standard. Auto-select fails →
  `selectedMailbox = ''` → `fetchEmails(undefined)` → no `inMailbox`
  filter → backend returns empty or a different mailbox's emails.

**Fix:** widen auto-select to mirror sidebar's icon logic — match `role
=== 'inbox'` first, fall back to `name.toLowerCase() === 'inbox'`. Match
in `stores/email-store.ts` and the sidebar should agree.

**Recognize it again:** mailbox count populated but email list empty.
Check the new `[fetchEmails]` console log — it tells you the resolved
mailbox name + id + acct + result count on every call. If the call
went out with `id=<undefined>` or `id=<wrong-mailbox>`, this is the
class of bug.

### B2. Retry budget of 1+2+3+4+5 seconds = 15 seconds of frozen UI

**Symptom:** "inbox takes 15 seconds to load."

**Root cause:** retry loop in `app/[locale]/page.tsx` for upstream issue
#217 (first-login lazy provisioning) used `Math.min(1000 * attempt,
5000)` for 5 attempts. Sum = exactly 15s.

**Fix:** tighter budget — 2 retries at 250ms + 500ms (max 750ms). For
truly-empty accounts the empty-inbox UI is the honest signal, not a
spinning retry.

**Recognize it again:** when a user reports a load time that matches a
backoff sum (1+2+3+4+5, 1+2+4+8+16, etc.), that's almost always a retry
loop pattern. Pattern-match before profiling.

### B3. Two concurrent prefetch chains stomp on each other

**Symptom:** intermittent post-login empty inbox.

**Root cause:** `auth-store.login()` kicks off `prefetchInitialData`
(fire-and-forget). `app/[locale]/page.tsx`'s fallback effect *also*
launched its own `fetchMailboxes`/`fetchEmails` chain when
`mailboxes.length === 0`. Both fired, two `fetchEmails` calls raced,
the second-to-return could clobber the first.

**Fix:** the fallback effect now calls `prefetchInitialData` itself.
The `__prefetchPromise` stash on the client coalesces — a second caller
gets the same promise, not a parallel chain.

**Recognize it again:** any "race between auth flow and home page" smell
should look for fire-and-forget kickoffs in `auth-store` plus a
mirroring effect in the page.

---

## C. nginx + OrdoEpistola integration (same-origin proxy)

### C1. `X-Forwarded-Proto $scheme` on the loopback → EPROTO on every render

**Symptom:** every page returns `500 Internal Server Error` while
`/api/health` keeps returning 200. journalctl shows repeated
`Failed to proxy https://localhost:3000/en Error: write EPROTO`.

**Root cause:** next-intl's middleware does an internal fetch to
`http://localhost:3000` using whatever scheme the *outer* request claims
via `X-Forwarded-Proto`. With `https`, Node tries a TLS handshake against
the local HTTP server → EPROTO.

**Fix:** in the `location /` block of `webmail.saltnlightllc.com.conf`,
set `proxy_set_header X-Forwarded-Proto "";` (empty, not `$scheme`).
The JMAP/auth/well-known locations *keep* `X-Forwarded-Proto https`
because OrdoEpistola needs the public scheme for OIDC discovery URLs.

**Recognize it again:** `/api/health` 200 while everything else 500 is
the canary — it's the only route that bypasses next-intl. Check
journalctl for `EPROTO` or `tls_get_more_records: packet length too long`.

### C2. `/.well-known/jmap` returns 404 → "Failed to get session: 404"

**Symptom:** browser console:
`GET /.well-known/jmap 404` then `Login error: Failed to get session: 404`.

**Root cause:** the bundled nginx conf proxied `/.well-known/jmap`
upstream. Stalwart's JMAP impl doesn't serve that endpoint — its session
document is at `/jmap/session`. RFC 8620 says clients fetch
`/.well-known/jmap` expecting either the session JSON *or a redirect to
it*.

**Fix:** synthesize the 307 in nginx:

```nginx
location = /.well-known/jmap {
    return 307 /jmap/session;
}
```

**Recognize it again:** login fails at the session-discovery step
(JMAP client lib logs "Failed to get session"). Check nginx's response
to `/.well-known/jmap` directly.

### C3. Default 443 vhost permanent-redirects poison browser caches

**Symptom:** after a cert cutover, browsers keep redirecting
`webmail.saltnlightllc.com` → `saltnlightllc.com` even after the conf is
fixed. Hard refresh doesn't help.

**Root cause:** during the cutover window the `webmail.*` vhost was
moved aside; nginx fell through to `hybridportal.conf`'s default 443
server which `return 301 https://saltnlightllc.com$request_uri`.
Browsers cache 301s indefinitely.

**Fix:** the portal :80 and :443 redirect blocks now emit
`Cache-Control: no-store, no-cache, must-revalidate` so future cutovers
can't poison clients. Lives in `C:/src/Saltnlight/deploy/nginx.conf`.

**Recognize it again:** "users keep getting redirected to the apex" + a
recent vhost change. Confirm with `curl -sI https://broken.example.com/`
— if the `Location` points away from broken.example.com but the on-disk
conf points to itself, it's a cached 301.

---

## D. Bundle and build hygiene

### D1. Locale catalogs in a client component shipped all 16 to every user

**Symptom:** 1.83MB entry chunk full of Czech/Japanese/etc. translation
strings even for English users.

**Root cause:** `components/providers/intl-provider.tsx` statically
imported all 16 `locales/<x>/common.json` files at the top of a `"use
client"` component, then picked one at runtime.

**Fix:** template-literal dynamic import:

```ts
const messages = (await import(`@/locales/${locale}/common.json`)).default;
```

This tells the bundler "match these paths, emit one chunk per match,
pick at runtime." Combined with a module-scope `Map` cache for
already-loaded locales and seeding the cache with the SSR-provided
initial messages so initial render is async-free.

**Recognize it again:** entry chunk inspection. `grep -ao "[a-z]*"` the
biggest chunk; if it has tokens from languages you don't actively use,
you have a static-import leak.

### D2. dist/ grew to 7.4GB across many builds → 7GB scp uploads

**Symptom:** deploy upload stalled. tarball was 7.2GB. previous tarballs
were ~400MB.

**Root cause:** `xtask pack` wrote a new timestamped tarball into
`dist/` every run but never cleaned old ones.

**Fix:** `pack()` now `rmSync(DIST, {recursive, force})` at start.
Caller-supplied outfile paths outside dist/ are untouched.

**Recognize it again:** `du -sh dist/` should always be < 100MB. If it's
larger, old tarballs leaked.

### D3. `node_modules/.bin/` symlinks half-populated → "tsc not found"

**Symptom:** `xtask verify` fails with
*"This is not the tsc command you are looking for"* even though
`node_modules/typescript/` exists.

**Root cause:** an interrupted or partial `npm ci`/`npm install` left
`.bin/` without the binary-shim symlinks.

**Fix (recovery):**

```sh
rm -rf node_modules
npm ci --no-audit --no-fund
```

A bare `npm install` will *sometimes* fix it but isn't reliable on
Windows.

**Recognize it again:** `ls node_modules/.bin/tsc` returns "No such
file or directory" while `ls node_modules/typescript/bin/tsc` succeeds.

The new `xtask doctor` command checks this and prints the fix.

---

## E. Diagnostic discipline

### E1. `debug.log` is silent in prod — use `console.info/warn` for prod-visible breadcrumbs

`lib/debug.ts`'s `debug.log` is gated behind the `debugMode` setting.
That's correct for routine instrumentation but the wrong choice for
breadcrumbs you want in *every* user's console when an issue hits prod.

Rules of thumb:
- `console.info` for "this routine path executed; here's how long it
  took and what came back" — one per user-initiated action, not per
  render. Shows up in normal users' DevTools.
- `console.warn` for "this path is degraded but recoverable" (retry
  fires, fallback used, response was empty when count said otherwise).
- `console.error` for "this should never happen and it did."
- `debug.log` for "operator turned debugMode on because they want
  noise" — deep wire-protocol details.

Examples from this session: the `[fetchEmails]` and `[Inbox] prefetch
settled` lines are `console.info` because they made the diagnostic
loop go from "we have no idea" to "we know exactly which leg failed."

### E2. Smoking-gun pattern recognition

When a user reports a number, check it against common patterns *before*
profiling:

| Number | Likely cause |
|---|---|
| 15s | 1+2+3+4+5 retry backoff |
| 7s, 14s, 28s | Doubling backoff (1+2+4 or 1+2+4+8 etc.) |
| 30s, 60s | Default fetch timeout |
| 1.8–2.2s | First-request TLS handshake (upstream keepalive cold) |

A mailbox count vs. an email-list mismatch is a *server-vs-query* signal
— Mailbox/get and Email/query disagree, which means the bug is in one of:
- the query's filter (wrong inMailbox id)
- the query's account scope (wrong accountId)
- the server itself

---

## F. AWS / DNS / cert operational notes

### F1. `aws ssm put-parameter` from Git-Bash on Windows fails — use PowerShell

`aws ssm put-parameter --name '/saltnlight/webmail/.../session-secret'`
fails with `ValidationException: Parameter name must be a fully qualified
name` when run from Git-Bash. Same exact command works from PowerShell.
Cause: MSYS path translation mangles the leading slash even inside
single quotes. Reads (`get-parameter`) work from either shell.

### F2. saltnlightllc.com DNS is on HostGator, not Route 53

`aws route53 list-hosted-zones` returns `[]` for this account. The zone
lives at `hgns1/hgns2.hostgator.com`. AWS CLI cannot manage these
records. HostGator console login creds are in 1Password's shared
vault per `saltnlight-ops/credentials-index.md`.

HostGator's cPanel auto-creates `webmail.<sub>.*` records pointing at
`50.6.x.x` (HostGator's shared webmail UI). These are harmless
leftovers; ignore them when adding new records.

### F3. Cert issuance with a "conf references a not-yet-existent cert" gotcha

When the bundled nginx conf references a cert that doesn't exist yet,
`nginx -t` fails and `certbot --nginx` can't proceed. The dodge:

```sh
# 1. Strip the conf to its port-80 block only (so nginx -t passes)
sudo head -n <last-line-of-:80-block> /tmp/conf.deferred \
    | sudo tee /etc/nginx/conf.d/<vhost>.conf
sudo nginx -t && sudo systemctl reload nginx
# 2. Issue via webroot (no nginx-config edits needed)
sudo certbot certonly --webroot \
    -w /var/www/letsencrypt \
    -d <vhost>
# 3. Restore the full conf (now the ssl_certificate paths exist)
sudo cp /tmp/conf.full /etc/nginx/conf.d/<vhost>.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## G. Service Workers and PWA quirks

- An empty `addEventListener("fetch", () => {})` satisfies Chrome's PWA
  installability criteria *without* introducing real caching. Don't add
  caching to the SW unless you also implement deliberate invalidation.
- A SW registered during a broken cert/redirect window can hold the
  bad response in cache *forever* from the user's perspective. Recovery:
  DevTools → Application → Service Workers → Unregister. Or ship a new
  SW file (any byte change triggers update).
- "Banner not shown: beforeinstallpromptevent.preventDefault()" in
  console is *informational*, not an error — the app deliberately
  suppressed Chrome's auto-install banner. Working as intended.
- "A listener indicated an asynchronous response by returning true, but
  the message channel closed before a response was received" is a
  *browser extension* error (password managers, Grammarly, etc.). Not
  us. Confirm by reproducing in incognito.

---

## H. What we should automate (forward-looking)

- ✅ `xtask pack` cleans dist/ at start (commit `f8fbcde`)
- ✅ `xtask clean` command — wipe `dist/`, `.next/`, `test-results/`,
  `tmp/`
- ✅ `xtask doctor` command — check `node_modules/.bin/` symlinks,
  `dist/` size, that `npm ci` has run
- 🟡 Integration test for inbox load (vitest + mocked JMAP) so the
  "auto-select + fetchEmails returns inbox contents" path regresses
  loudly next time
- 🟡 Service worker version-bump on every release so revisits clear
  any wedged caches automatically
- 🟡 Bundle-size budgets in `xtask verify` — fail the verify gate if any
  entry chunk crosses a threshold (e.g., 1 MB)

The first three rows are landed in this same launch arc; the latter
three are deferred candidates with the rationale captured here so
future-you can pick them up.
