# Perf measurement scripts

Synthetic interaction-perf measurements against the deployed app, used to
catch runtime regressions (FCP / LCP / CLS / long-task time / INP-proxy via
event-timing). Run them by hand before and after any non-trivial change to
hot-path components, stores, or providers.

For ongoing real-user metrics from your own sessions, use the Web Vitals
beacon (already wired up — see `app/api/web-vitals/route.ts` and
`lib/web-vitals-client.ts`) and tail
`/var/log/ordonuntius/web-vitals.jsonl` on the server.

## Scripts

### `measure-login.mjs`

Exercises the unauthenticated login page: mount → type username → tab to
password → type password. Captures Core Web Vitals and per-keystroke event
timings (a proxy for the same controlled-input path the composer uses).

```bash
node scripts/perf/measure-login.mjs
PERF_BASE=https://staging.example.com node scripts/perf/measure-login.mjs
HEADLESS=false node scripts/perf/measure-login.mjs   # see the browser
```

Run 3 times — the first is cold (JIT warmup + CDN cache miss) and often
shows a 100-200ms outlier on the first keystroke. Runs 2 and 3 are the
meaningful baselines.

### `measure-inbox.mjs`

Drives the demo inbox: login → "Try demo" → scroll → click first email.
**Requires `DEMO_MODE=true` on the target deploy.**

```bash
node scripts/perf/measure-inbox.mjs
```

To temporarily flip DEMO_MODE on prod (and revert after measuring):

```bash
ssh ec2 'sudo cp /etc/ordonuntius/ordonuntius.env /etc/ordonuntius/ordonuntius.env.bak.preDemo'
ssh ec2 'echo "DEMO_MODE=true" | sudo tee -a /etc/ordonuntius/ordonuntius.env'
ssh ec2 'sudo systemctl restart ordonuntius && sleep 3'

# Confirm:
curl -s https://webmail.saltnlightllc.com/api/config | grep -oE '"demoMode":(true|false)'

# Measure:
node scripts/perf/measure-inbox.mjs
node scripts/perf/measure-inbox.mjs   # second pass for warm cache

# Revert:
ssh ec2 'sudo cp /etc/ordonuntius/ordonuntius.env.bak.preDemo /etc/ordonuntius/ordonuntius.env && sudo rm /etc/ordonuntius/ordonuntius.env.bak.preDemo'
ssh ec2 'sudo systemctl restart ordonuntius && sleep 3'
curl -s https://webmail.saltnlightllc.com/api/config | grep -oE '"demoMode":(true|false)'   # should print false
```

**Caveat:** the demo inbox has only a handful of seed emails, so the
virtualizer never gets meaningfully exercised. The mount / click / typing
paths are honestly measured; the scroll path isn't stressed.

## Baseline expectations

As of 2026-05-20 (post-runtime-perf-wave) these scripts should produce, on
warm cache:

| Metric | Login page | Demo inbox |
|---|---|---|
| FCP | 240-260ms | 250-260ms |
| LCP | 360-400ms | 370-400ms |
| CLS | 0 | 0 |
| Long tasks during mount | 0 | 0 |
| p98 event timing | 16-24ms | ≤16ms |

Significant departures (e.g. FCP > 500ms, long tasks > 0 during mount,
worst keystroke > 50ms in steady-state) deserve investigation before
shipping.

## How this fits with the Web Vitals beacon

These synthetic scripts complement the beacon — they don't replace it:

- **Beacon** (passive, real users, ongoing): captures whatever the user
  actually does. Aggregates over time. Best for "is the app fast for the
  user right now?".
- **Synthetic scripts** (active, reproducible, on-demand): same flow every
  run, controlled environment. Best for "did my last commit make X faster
  or slower?".

For perf review of a specific PR: run the synthetic scripts before and
after, compare the numbers. For "should I be worried about real-user
perf?": tail the beacon log.
