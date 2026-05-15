# xtask — local CI runner

OrdoNuntius does not run CI on GitHub. The shipping lane is operator-local:
every check that would have run in CI is encoded here so a single command
gates the release.

Mirrors the `cargo xtask <command>` pattern used by the Rust-side Salt &
Light projects (Legacylocker, OrdoEpistola). Node port — no Rust dependency,
no new packages, only `node:child_process` + `node:fs`.

## Commands

```sh
npm run xtask -- help                # list commands
npm run xtask -- verify              # typecheck + lint + translations test
npm run xtask -- build               # next build (turbopack, standalone)
npm run xtask -- pack [outfile]      # assemble .next/standalone tarball
npm run xtask -- release             # verify + build + pack — full local release gate
npm run xtask -- deploy <env> [ssh]  # release + scp + remote install via infra/scripts/deploy-ec2.sh
                                     # env: email-lab | staging | prod
                                     # ssh: default ordo-epistola
npm run xtask -- clean               # wipe dist/, .next/, test-results/, tmp/
                                     # (build outputs only; node_modules kept)
npm run xtask -- doctor              # pre-flight self-check before deploy
```

## Build hygiene

`pack` wipes `dist/` at start, so it never accumulates old tarballs
across deploys. (Unchecked accumulation was the cause of the 2026-05-15
7.2 GB scp stall — one tarball per deploy was getting shipped together.)

`.next/` is managed by `next build` and grows with turbopack's
incremental cache. If it crosses ~2 GB or you suspect a stale build is
affecting output, `xtask clean` wipes both `dist/` and `.next/` (next
deploy rebuilds from scratch).

## Pre-deploy doctor

`xtask doctor` checks the workstation for the failure modes that have
bitten us in production:

| Check | Why |
|---|---|
| `node_modules/.bin/{tsc,eslint,next,vitest}` present | Partial `npm install` / `npm ci` runs leave `.bin/` half-populated; `npx tsc` then fetches a wrong binary and `verify` fails confusingly. Fix: `rm -rf node_modules && npm ci`. |
| `dist/` < 500 MB | Bloat indicator. `xtask clean` wipes it. |
| `.next/` < 2 GB | Turbopack incremental cache bloat. Same fix. |
| `git status` clean | Advisory — deploys ship from working tree, so uncommitted changes are surfaceable but not blocking. |
| SSH alias `ec2` resolves | Lightweight host reachability check — saves the time of getting through verify+build only to scp-fail. |

A clean `doctor` is a green light for `deploy`. A non-clean `doctor`
exits non-zero with the exact fix command for each issue.

See `infra/runbooks/lessons-learned-2026-05-15.md` for the failure
modes that drove these checks.

## Gate contract

`npm run xtask -- release` is the canonical "is this ready to deploy?" gate.
A green release means:

1. `tsc --noEmit` returned exit 0 — no type errors.
2. `next lint` returned exit 0 — no lint errors (warnings tolerated; see
   the existing baseline in `eslint.config.mjs`).
3. `vitest run lib/__tests__/translations.test.ts` returned exit 0 — i18n
   keys are present across all 15 locales.
4. `next build` produced `.next/standalone/server.js`.
5. The release tarball is written to
   `dist/ordo-nuntius-<sha>-<stamp>.tar.gz` and contains exactly:
   - `server.js` + the standalone `.next/` directory
   - `.next/static/`
   - `public/`
   - `install/` (systemd unit template, nginx site config,
     `install-ordo-nuntius.sh`, `RELEASE.json`)

`deploy` requires `release` to have just succeeded — the deploy reuses the
tarball it just produced, not a stale one.

## Why a Node script, not a shell script

The Rust-side ecosystem uses `cargo xtask` to keep CI logic close to the
language toolchain it tests. The Node equivalent is a `.mjs` script in
`xtask/` invoked via `npm run xtask --` — same spirit, same zero-new-deps
constraint, runs on Windows/macOS/Linux without Bash assumptions.

## What this does NOT do

- Push tags or releases to GitHub. Tagging is a manual operator step.
- Upload artifacts to S3 or any remote store. The tarball lands in `dist/`
  and gets scp'd directly to the target host by `deploy`.
- Generate provenance / SBOM / signing. Out of scope for v1.
