# OrdoNuntius — agent guidance

Project-specific rules for any assistant working in this repo. Global rules
in `~/.claude/CLAUDE.md` still apply.

## Deploy contract

The deploy script does NOT auto-restart the running process. After every
deploy:

```bash
rtk npm run xtask -- deploy email-lab ec2
ssh ec2 'sudo systemctl restart ordonuntius && sleep 3 && sudo systemctl is-active ordonuntius'
# smoke
for path in / /en /en/calendar /en/contacts /en/files /en/settings /login /setup /api/health; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://webmail.saltnlightllc.com$path")
  echo "$code $path"
done
```

The systemd unit has an ExecStartPost warmup loop (`infra/systemd/ordonuntius.service.template`)
so the first user after a restart doesn't eat the ~3s Next.js route-compile
cold-start. If you change page routes, the warmup may need updating.

## Logging — the buffering gotcha

`logger.info()` (and `logger.warn`/`.error`) calls now use synchronous
`fs.writeSync` to fd 1/2 (see `lib/logger.ts`) — output reaches journal
reliably. Before this fix, Node's pipe-buffered stdout under systemd was
swallowing every `console.log` from a request handler indefinitely.

**For ongoing structured records (audit trail, beacons, metrics) — write
to a dedicated file, not stdout.** The logger fix makes stdout viable for
diagnostic messages, but a file is still the right primitive for anything
you want to `grep` over later. Pattern:

```ts
import { appendFile } from 'node:fs/promises';
appendFile('/var/log/ordonuntius/your-thing.jsonl', JSON.stringify(entry) + '\n')
  .catch((err) => logger.warn('appendFile failed', { error: err.message }));
```

Examples already in the repo: `lib/admin/audit.ts`, `app/api/web-vitals/route.ts`.

## Perf work

We have two complementary perf measurement primitives — use them before
chasing speculative optimization.

1. **Web Vitals beacon** (passive, ongoing) — `lib/web-vitals-client.ts`
   sends CLS/LCP/FCP/INP/TTFB for every real session to
   `/api/web-vitals` which appends to
   `/var/log/ordonuntius/web-vitals.jsonl`. Tail with:
   ```bash
   ssh ec2 'sudo tail -F /var/log/ordonuntius/web-vitals.jsonl'
   ```
   If the metrics there are all "good" rated, runtime perf is fine — don't
   invent new optimization work without specific signal.

2. **Synthetic measurement** (active, reproducible) — `scripts/perf/`:
   - `measure-login.mjs` — unauthenticated login + typing
   - `measure-inbox.mjs` — demo-inbox flow (requires `DEMO_MODE=true`)

   Run before/after non-trivial changes to hot paths (stores, providers,
   virtualizer-rendered components). **Always run ≥3 times** — the first
   run is cold (JIT + CDN) and produces outliers that aren't signal.

3. **Cold-load baseline** — `scripts/perf/README.md` has the expected
   numbers. Memory files `project_ordonuntius_cold_load_baseline.md` and
   `project_ordonuntius_interaction_baseline.md` have the historical
   record. The repo has gone through many rounds of cold-path defer work
   already (see `project_ordonuntius_cold_path_defers.md`) — most easy
   wins are taken. Before suggesting "defer X", check whether X has
   already been deferred.

## Verification discipline

"The deploy returned green" ≠ "the change works." For changes that emit
data (logs, beacons, audit records), the smoke step must include reading
back the data you expect:

```bash
# bad: assume 204 means it worked
curl -s -o /dev/null -w "%{http_code}\n" $URL

# good: verify the data landed
curl -s -X POST -d "$BODY" $URL && ssh ec2 'sudo tail -1 /var/log/.../the-file.jsonl'
```

The Web Vitals beacon spent 20 minutes appearing to work (returning 204)
before we noticed nothing was actually being logged — that's the
buffering bug, and a more rigorous smoke would have caught it
immediately.

## What NOT to do

- **Don't chase runtime perf without baseline data.** If the beacon log
  shows everything "good", any "perf win" you ship is speculative.
- **Don't use `logger.info()` for records you need to grep later.** Use
  `fs.appendFile` to a dedicated file. See `lib/admin/audit.ts` for the
  pattern.
- **Don't declare an audit "exhausted" with confidence.** This repo has
  surprised us multiple times — the codebase is well-tuned but there are
  always more leaves on the tree. Phrase findings as "I didn't find more
  in this pass" rather than "we're done".
- **Don't trust a single measurement run.** Cold JIT, CDN cache misses,
  and first-byte buffering all produce outliers. ≥3 runs, report the
  steady-state, flag the cold outlier as such.
- **Don't ship without running the 9-endpoint smoke.** It catches
  surprisingly subtle deploy failures.

## Where to find things

- Memory pointers (these persist across sessions): `MEMORY.md` in the
  agent's project memory. Includes deploy map, cold-load baseline,
  interaction baseline, beacon design, logger buffering gotcha.
- Synthetic perf scripts: `scripts/perf/`
- Web Vitals server: `app/api/web-vitals/route.ts`
- Web Vitals client: `lib/web-vitals-client.ts`,
  `components/providers/web-vitals-reporter.tsx`
- Logger: `lib/logger.ts`
- Audit log: `lib/admin/audit.ts`
- Systemd unit: `infra/systemd/ordonuntius.service.template`
- Deploy task: `xtask/index.mjs` and `xtask/` subcommands
