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
```

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
