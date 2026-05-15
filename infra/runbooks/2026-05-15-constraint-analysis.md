# Constraint analysis — OrdoNuntius + AWS production (2026-05-15)

Applying the Theory of Constraints discipline from
`C:/src/principles/execution-doctrine.md §5` ("Focus effort on the true
constraint") and `§6` ("Prefer evidence to confidence") to identify the
real bottleneck in OrdoNuntius's loading and operation speed, including
its place in the dependency chain that ends at OrdoDB.

The five ToC steps applied here:

1. State the system goal in measurable terms.
2. Identify the constraint, **with evidence**.
3. Subordinate everything else to the constraint.
4. Elevate the constraint.
5. Re-measure; the bottleneck will move.

This document executes steps 1–4. Step 5 is empirical — re-measure after
each intervention.

---

## 1. System goal and metric

> A user with an existing session opens `https://webmail.saltnlightllc.com/`
> and sees their inbox populated within **1 second** on a residential
> broadband connection (≈25 Mbps, ≈40 ms RTT to us-east-2).

Sub-goals:

- **Cold first load** (no JS cached, no service worker active):
  inbox visible ≤ 3 s (today: measured ~4.4 s to networkidle on the
  *login* page — inbox is unmeasured but likely +1–2 s).
- **Warm subsequent load** (JS cached, SW active): inbox visible
  ≤ 1 s.
- **Email open / archive / delete**: action latency ≤ 200 ms (user
  perceives instant).
- **Inbox-action correctness**: zero "phantom empty" states like the
  2026-05-15 "sidebar says 8 unread, list shows No messages found"
  symptom.

These targets are higher than what the system delivers today. Use them
to discriminate: a candidate fix that gets us from 4.4 s to 4.2 s is
not interesting if the constraint requires 3 s of cut.

---

## 2. Pipeline decomposition

Cold first load decomposes into linear stages. Each stage's latency
comes from measured data this session (✓) or principled estimate (~):

| # | Stage | Latency | Source |
|---|---|---|---|
| 1 | DNS resolution | 5–50 ms | typical residential resolver |
| 2 | TCP + TLS handshake to webmail | 50–200 ms | RTT × 2–3, one-time |
| 3 | HTML response (Next.js SSR) | 30–80 ms TTFB ✓ | curl from host |
| 3a | Cross-network add for distant clients | +150–500 ms ✓ | playwright (US workstation) saw 2.95 s document TTFB |
| 4 | JS bundle download + parse | **~1.5–3 s** ✓ | 11 MB total chunks; 1.83 MB top chunk; 49 scripts at ~300 ms each parallel |
| 5 | JS hydrate + first paint | 200–500 ms ~ | typical Next.js standalone |
| 6 | Auth / `/jmap/session` | 13 ms warm ✓ / 2 s cold ✓ | curl probes |
| 7 | `Mailbox/get` (fetchMailboxes) | 100–400 ms ~ | unmeasured directly; one JMAP roundtrip |
| 8 | `Email/query` + `Email/get` (fetchEmails) | 200–800 ms ~ | unmeasured directly; two-step JMAP chain |
| 9 | Virtualized render | < 100 ms ✓ | `@tanstack/react-virtual` baseline |
| - | Sum of medians (cold, fast network) | ~ **2.4 s + RTT cost** | |
| - | Sum (cold, slow network) | ~ **5 s + RTT cost** | |

Stages 7 and 8 are serialized in `prefetchInitialData`
(`Promise.all([fetchMailboxes, fetchQuota])` *then* `fetchEmails`),
adding at least one full JMAP roundtrip of mandatory sequence.

The 15-second symptom you reported earlier was *not* in this table —
that was the now-removed retry loop (1+2+3+4+5 = 15 s back-off). It
was the wrong layer of constraint.

---

## 3. Constraint identification (with evidence)

### 3.1 Cold-load constraint: JS bundle size and request count

Evidence:

- Playwright probe of the live login page (commit `0eaf538`):
  - `page.goto('load')` = **3 522 ms**, networkidle = 4 395 ms.
  - 71 requests total. **49 of them were JS chunks**, sum 7 017 ms
    (parallel download).
  - Slowest individual chunk: `00ldx13~6b8zp.js` at 1 829 KB / 407 ms
    (this is the locale catalog blob).
  - Document TTFB: 2 953 ms (network-RTT dominated).
- Baseline snapshot (`tmp/bundle-snapshots/baseline.txt`):
  - `.next/static/chunks/` total = **11 MB**.
  - 5 chunks at exactly 580 KB (likely duplicated icon shipments).
  - `pkijs` + `asn1js` + `webcrypto-liner` (S/MIME stack) =
    **1.15 MB**, statically imported by the email-viewer on the inbox
    path.
  - 16 locales in `locales/` totalling 2.2 MB, previously all in one
    entry chunk via `components/providers/intl-provider.tsx`.

Cumulative payload exceeds the connection's bandwidth-delay product
by 5–10× on most home links. JS download + parse dominates everything
upstream of stage 6.

**Falsification test**: if we cut the JS payload by 50% (~5.5 MB) and
total cold-load time barely improves, the constraint is elsewhere
(probably network RTT × request count). If it improves by ~40–60%,
this analysis was right.

### 3.2 Warm-load and steady-state constraint: JMAP roundtrip serialization

On a returning user with everything cached:

- Stages 1–5 sum to ~100 ms (one TLS, one HTML, one SSR).
- Stage 6 (`/jmap/session`) is 13 ms warm.
- Stages 7 + 8 are two *serialized* JMAP roundtrips, each ~100–400 ms.

The warm steady-state TTI is therefore ~400 ms in the best case, ~1 s
in the bad case. The constraint shifts from "bandwidth" to
"serialized round-trips."

Evidence we *don't* yet have:

- Server-side timing of `Mailbox/get`, `Email/query`, `Email/get` from
  OrdoEpistola's perspective.
- OrdoDB's own slow-log output.
- Whether `Email/query` for a populated inbox returns 0 because of a
  *query-construction* issue on OrdoNuntius's side or a *DB-side*
  issue inside OrdoEpistola/OrdoDB. The new `[fetchEmails]` console
  breadcrumb (this session's diagnostic add) will distinguish these
  on the next reload.

### 3.3 Operational constraints (separate from runtime)

- **Deploy upload size**: was 7.2 GB until commit `f8fbcde` cleaned
  `dist/` at start of `xtask pack`. Now ~42 MB. Resolved.
- **Local `node_modules/.bin/` half-state**: blocked verify until
  fresh `npm ci`. Now flagged by `xtask doctor`. Resolved.
- **AWS / DNS gaps**: instance role lacked SSM read for
  `/saltnlight/webmail/...`, registrar is HostGator not Route 53. Fixed
  for `email-lab` tier; both gaps documented in
  `lessons-learned-2026-05-15.md`.

These are *operator-throughput* constraints, not runtime constraints.
They cost developer time, not user time.

---

## 4. Where OrdoDB sits in the constraint hierarchy

**Short answer**: OrdoDB is **not yet a measured constraint**. The
evidence chain stops upstream of it.

OrdoNuntius does not depend on OrdoDB directly — the `"ordodb"` token
in `package.json` is a keyword string, not a dependency. The runtime
relationship is:

```
OrdoNuntius (Next.js)
    │
    │ HTTP/JMAP (RFC 8620) — same-origin via nginx
    ▼
OrdoEpistola (Rust, on email-lab box)
    │
    │ Rust function calls
    ▼
OrdoDB (Rust, embedded inside OrdoEpistola)
    │
    │ I/O to storage backend
    ▼
Local disk
```

For OrdoDB to be the system constraint, *all three* of these must hold:

1. The JMAP query latency for `Email/query` is high enough to dominate
   the warm-load critical path (>> 100 ms per call).
2. The high latency is coming from inside OrdoEpistola's call to
   OrdoDB (not from JSON encoding, network, or auth middleware).
3. OrdoDB's own latency is high relative to its theoretical lower
   bound (e.g., missing index, full scan, poor cache locality).

**Today we know none of these empirically.** What we know:

- OrdoDB's documentation (`C:/src/OrdoDB/README.md`) advertises
  "ultra-high observability" with `SlowLog` and `LatencyMonitor`
  (`crates/ordo-storage/src/latency_monitor.rs`).
- OrdoEpistola embeds OrdoDB via `vendor/OrdoDB` (per its
  `Cargo.toml`).
- OrdoEpistola's `/metrics/prometheus` endpoint on
  `mail.saltnlightllc.com` returned 404 today, so server-side
  metrics aren't reachable from the OrdoNuntius side. Either the
  endpoint isn't enabled in this build, or it's at a different path.

The proper next step before claiming OrdoDB is or isn't a constraint:

1. Re-enable / locate OrdoEpistola's metrics endpoint and capture
   median + p99 latency per JMAP method.
2. Turn on OrdoDB's `SlowLog` with a 50 ms threshold and capture a
   representative session.
3. If OrdoEpistola's JMAP-method time minus OrdoDB's query time is
   meaningful (> 50 ms), the constraint is in OrdoEpistola's
   encoding / middleware / auth layer.
4. If OrdoDB's query time itself is the dominant contributor, look at
   indexing on the `Email/query` filter shape (inMailbox + sorted by
   receivedAt desc).

Until that's measured, treating OrdoDB as the constraint would
violate execution-doctrine §6 ("Prefer evidence to confidence").

---

## 5. Subordinate everything else; elevate the constraint

Per ToC step 3: choose every other change *to support* the constraint
work, not to relieve well-measured non-constraint stages.

### 5.1 First-pass interventions (already shipped or in progress)

| # | Intervention | Targets | Status |
|---|---|---|---|
| 1 | Per-locale lazy chunk via template-literal `import()` | Stage 4 (–~1.7 MB on en-only users) | shipped commit `1f7b09d` |
| 2 | Tighten retry budget 15 s → 750 ms | Stage 7/8 perceived | shipped commit `1f7b09d` |
| 3 | Lenient inbox auto-select | Stage 8 correctness (the "No messages found" bug) | shipped commit `2b33f19` |
| 4 | Collapse race between prefetch and fallback effect | Stage 7/8 correctness | shipped commit `e0e9a20` |
| 5 | `xtask clean` + `doctor` | Operator throughput | shipped commit `8c467e3` |
| 6 | `[fetchEmails]` prod-visible breadcrumb | Diagnostic for stages 7/8 | shipped commit `2b33f19` |
| 7 | Lazy-load S/MIME stack (pkijs/asn1js/webcrypto-liner) | Stage 4 (–1.15 MB on inbox path) | shipped commit `a9f83ed` |
| 8 | deploy-ec2.sh reuse xtask pack tarball | Operator throughput (–60-120s per deploy) | shipped commit `878bfbe` (verified: 88s end-to-end deploy) |
| 9 | `optimizePackageImports` for barrel libs | Stage 4 (defensive; Turbopack support varies) | shipped commit `17e765d` |
| 10 | Bundle-size budget gate in `xtask release` | Regression guard | shipped commit `17e765d` |
| 11 | Middleware fast-path skip for static/_next/api | Per-request microtask cost on every page | shipped commit `943e795` |
| 12 | Newsreader font trim 6 variants → 1 | First-paint critical path (–~150 KB woff2) | shipped commit `943e795` |

### 5.2 Second-pass interventions (queued, prioritized by ToC step 4)

In order from highest expected leverage to lowest, with falsification
criteria:

1. **Dynamic-import S/MIME from email-viewer and smime-store** (stages
   4, 5). Currently `lib/smime/{smime-decrypt,smime-verify}.ts` are
   statically imported by `components/email/email-viewer.tsx`, and
   `stores/smime-store.ts` statically imports `pkcs12-import` +
   `certificate-utils`. Together this pulls 1.15 MB of pkijs/asn1js
   into the inbox bundle. Move to `await import()` gated on
   `detectSmime(...)` returning non-null. Expected: –1.1 MB from cold
   load. Falsified if total cold time doesn't drop ≥ 400 ms.

2. **Audit the 5×580 KB icon chunks** (stage 4). Lucide-react is being
   shipped five times in identical chunks — either Turbopack
   duplication, or icons are being eagerly imported in five separate
   route bundles. Switch to per-icon deep imports
   (`import Inbox from 'lucide-react/dist/esm/icons/inbox.js'`) where
   the call sites are concentrated. Expected: ~–2 MB; falsified if
   only one of the five chunks holds icons.

3. **Server-side OrdoEpistola/OrdoDB observability** (stages 7, 8).
   Re-enable Prometheus metrics, sample a representative session,
   identify whether the constraint lives there. This is the
   measurement work that decides whether OrdoDB is a real constraint
   or speculation. Falsified if median Email/query is < 50 ms — in
   which case stop talking about OrdoDB and focus on stages 4 / 7
   request count.

4. **Service worker cache for `/jmap/session` and recent
   `Email/get`** (warm steady-state stages 6, 8). Stale-while-
   revalidate would make second-tab opens of the inbox feel instant.
   Larger refactor; defer until first three rows land and re-measure.

5. **JMAP request coalescing** (stages 7, 8). Several JMAP calls
   could be batched into single `urn:ietf:params:jmap:core` envelopes
   if their dependencies allow. Deferred — speculative; measure first.

6. **Bundle-size budget in `xtask verify`** (cold-load regression
   guard). Once we cut the bundle, prevent regression by failing the
   verify gate if any entry chunk exceeds e.g. 500 KB.

### 5.3 Things NOT to do until the constraint moves

- Optimize the email-list render path further. Already at sub-100 ms
  with virtualization and granular zustand selectors. Below the noise
  floor of stages 4 + 6 + 7 + 8.
- Switch to a different DB. Pure speculation until §5.2 row 3 has data.
- HTTP/3, edge functions, brotli pre-compression. Each saves 10–50 ms
  of RTT. Noise relative to the 1.5–3 s JS payload cost.
- Critical-CSS inlining. Same scale issue.

This list is here because the temptation in performance work is to do
everything; ToC explicitly forbids that.

---

## 6. Operator-throughput constraints (the other system)

The "deploy a fix" pipeline is its own system with its own goal:
*operator changes a line of code and the change is serving production
users within 5 minutes*.

Today's pipeline:

| Stage | Time | Notes |
|---|---|---|
| Verify (typecheck + lint + translations) | 30–60 s | well-tooled |
| Build (`next build --turbopack`) | 60–120 s | turbopack incremental, slow on cold cache |
| Pack tarball | 5–10 s | small now that `dist/` cleans |
| SCP to host | 15–60 s | network-bound, ~40 MB |
| Host install (`install-ordo-nuntius.sh`) | 60–120 s | does its own `npm ci && npm run build` (wasted work — see below) |
| Manual restart + nginx reload | 5–10 s | gated by canary checklist |

**Total: 3–6 minutes** of human-attended time, often more if anything
fails. The constraint here is the host-side `npm ci && npm run build`
re-doing what `xtask pack` already did locally. We ship a tarball that
contains the built `.next/standalone/...`, and then the host throws it
away and rebuilds. That's the cause of the 5–15 minute deploy times.

**Pre-prod fix** (high leverage, low risk): change
`infra/scripts/deploy-ec2.sh` to skip its `npm ci && npm run build`
when the uploaded tarball already contains the build artifacts (which
it does — `xtask pack` includes `.next/standalone` + `.next/static`).
The install script just needs to lay down the release directory and
swap the symlink. Expected: deploys go from 3–6 min to ~30 s. Defer
to a follow-up commit; this analysis is about runtime constraints
primarily.

---

## 7. The discipline: re-measure after each move (ToC step 5)

After every intervention from §5.2, run:

```sh
# bundle snapshot
du -sh .next/static/chunks/
find .next/static/chunks -name "*.js" -printf "%s %p\n" \
  | sort -rn | head -10

# cold-load timing (login page only, for now)
npx playwright test e2e/prod-inbox-load-probe.spec.ts  # if reinstated
# or curl-based proxy
for i in 1 2 3 4 5; do
  curl -sk -o /dev/null \
    -w "ttfb=%{time_starttransfer}s total=%{time_total}s\n" \
    https://webmail.saltnlightllc.com/
done
```

For authenticated inbox loads, the `[fetchEmails]` console breadcrumb
landed in commit `2b33f19` already prints the per-fetch breakdown.
Capture the line from DevTools after each significant change.

---

## 7.5 Empirical state after first-pass interventions

Measured post-shipping (commit `17e765d`/`943e795`, build manifest):

- **Inbox initial-paint JS payload**: ~446 KB across 5 files in
  `rootMainFiles`. No heavy libraries leak into the entry path:
  React (227 KB), app shell (135 KB), boot scripts (~80 KB),
  turbopack runtime (10 KB).
- **Largest chunk overall**: 750 KB (lazy asn1js, never loaded
  unless the user opens an S/MIME message).
- **Bundle budget**: 1500 KB per chunk; current largest is 50% under
  budget, so future regressions like the original 1.83 MB locale
  catalog get caught by `xtask release` before deploy.
- **Cold-load on-wire HTML**: 31 KB brotli-compressed (down from
  131 KB raw — already efficient).
- **Deploy pipeline wall-clock**: 88 s for the full flow (verify +
  build + pack + scp + remote install + restart), down from a
  previous baseline of 3–6 minutes.

The remaining cold-load constraint is **network RTT × request count**
(see §3.1 falsification test). Bundle work has largely diminished:
shrinking the entry path further yields sub-100 ms gains on most
connections, while the four remaining big levers (service worker
cache, JMAP back-reference batching, critical CSS inline, OrdoEpistola
server-side timing) target *different* constraints. Continue with
§5.2 row 3 (server-side observability) once OrdoEpistola recovers —
that experiment decides whether OrdoDB is a real constraint.

## 8. Summary in one paragraph

The cold-load constraint is **JS bundle size**, with measured evidence
from a 4.4-second playwright probe dominated by 49 JS requests
totalling 7 s of cumulative parallel download against an 11 MB chunk
tree. The S/MIME stack (1.15 MB), the over-bundled locale catalogs
(1.83 MB — already fixed), and the apparently-duplicated icon chunks
(5 × 580 KB) are the three largest contributors. Network RTT × request
count is a secondary constraint that only becomes dominant after the
bundle shrinks past ~3 MB. The warm-load constraint shifts to two
*serialized* JMAP roundtrips (`Mailbox/get` then `Email/query`+`Email/get`),
each ~100–400 ms; total ~400 ms–1 s warm steady-state. **OrdoDB is
not measured to be a constraint** — the chain of evidence stops at
"we haven't profiled OrdoEpistola or OrdoDB end-to-end yet." Claiming
OrdoDB is the constraint without that measurement would be
confidence-not-evidence, and execution-doctrine §6 forbids it.
The first work to do is §5.2 row 1 (lazy-load S/MIME) because it's
high-leverage and the evidence already supports it; the parallel work
is §5.2 row 3 (turn on OrdoEpistola/OrdoDB metrics) because that's
the experiment that resolves whether the next constraint after row 1
ships is at the protocol layer or the DB layer.

---

**See also**:

- `infra/runbooks/lessons-learned-2026-05-15.md` — failure-mode
  appendix from the same launch arc (state subscription, nginx + JMAP
  gotchas, build hygiene, diagnostic discipline)
- `C:/src/principles/execution-doctrine.md §5 §6 §7` — the ToC and
  evidence-discipline anchors this analysis follows
- `C:/src/OrdoDB/docs/CANONICAL.md` — OrdoDB's own observability
  surface (SlowLog, LatencyMonitor)
- `tmp/bundle-snapshots/baseline.txt` — the bundle measurement used
  in §3.1
