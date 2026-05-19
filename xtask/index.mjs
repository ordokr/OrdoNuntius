#!/usr/bin/env node
// xtask — local CI runner for OrdoNuntius.
//
// Mirrors the `cargo xtask <command>` pattern used by Rust-side Salt &
// Light projects. See xtask/README.md for the gate contract.
//
// No external deps — uses only node:child_process + node:fs + node:path.

import { spawnSync, execSync } from "node:child_process";
import {
    cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
    rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
// Bundle budget threshold per .next/static/chunks/*.js. Must be declared
// at module top before main() is invoked below, otherwise checkBundleBudget
// (called from release() via main()) hits the temporal dead zone.
const CHUNK_SIZE_BUDGET_KB = 1500;

// File extensions worth precompressing. Binary formats (images, fonts that
// are already woff2-compressed, archives) get no useful brotli win and
// would just bloat the tarball.
const BROTLI_EXTS = new Set([".js", ".mjs", ".css", ".svg", ".json", ".txt", ".xml", ".html", ".webmanifest"]);
const BROTLI_MIN_BYTES = 1024;

function precompressBrotli(rootDir) {
    if (!existsSync(rootDir)) return;
    let count = 0;
    let savedBytes = 0;
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.isFile()) continue;
            const ext = extname(entry.name).toLowerCase();
            if (!BROTLI_EXTS.has(ext)) continue;
            const stat = statSync(full);
            if (stat.size < BROTLI_MIN_BYTES) continue;
            const buf = readFileSync(full);
            const compressed = brotliCompressSync(buf, {
                params: {
                    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
                    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
                },
            });
            // Skip cases where compression made the file bigger (rare for
            // already-minified output but possible for short JSON).
            if (compressed.length >= buf.length) continue;
            writeFileSync(full + ".br", compressed);
            count++;
            savedBytes += buf.length - compressed.length;
        }
    };
    walk(rootDir);
    console.log(`  brotli: ${count} files precompressed, ${(savedBytes / 1024).toFixed(1)} KB saved on the wire`);
}

const args = process.argv.slice(2);
const command = args[0] || "help";

const COMMANDS = {
    help, verify, build, pack, release, deploy, "check-dns": checkDns,
    clean, doctor,
};

main();

function main() {
    const fn = COMMANDS[command] || COMMANDS[command.replace(/^-+/, "")] || null;
    if (!fn) {
        console.error(`xtask: unknown command '${command}'`);
        help();
        process.exit(1);
    }
    try {
        fn(args.slice(1));
    } catch (err) {
        console.error(`xtask: ${err.message ?? err}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function help() {
    console.log(`xtask — local CI runner

Usage:
  npm run xtask -- <command> [args]

Commands:
  help                            this help
  verify                          typecheck + lint + translations test
  build                           next build (standalone output)
  pack [outfile]                  assemble release tarball from .next/standalone
  release                         verify + build + pack — full local release gate
  deploy <env> [ssh-alias]        release + scp + remote install
                                  env: email-lab | staging | prod
                                  ssh-alias default: ordo-epistola
  check-dns [mail-domain] [host]  verify SES outbound DNS (SPF, DMARC, DKIM,
                                  MX) for the Salt & Light mail lane.
                                  default mail-domain: saltnlightllc.com
                                  default host:        mail.saltnlightllc.com
  clean                           wipe dist/, .next/, test-results/, tmp/
                                  (build outputs only — node_modules is kept).
                                  Run before a release to guarantee a fresh build.
  doctor                          self-check the workstation before deploy:
                                  node_modules/.bin symlinks intact, dist/
                                  not bloated, git tree state sane. Prints
                                  a fix command for each issue it finds.

See xtask/README.md for the gate contract and
infra/runbooks/lessons-learned-2026-05-15.md for the failure-mode appendix.
`);
}

function verify() {
    section("verify");
    runStep("typecheck", "npx", ["tsc", "--noEmit"]);
    // Match the husky pre-commit invocation. `next lint` was removed/broken
    // in Next 16 — eslint directly is the working path. The eslint config
    // (eslint.config.mjs) ignores xtask/, .next/, dist/, e2e/, etc.
    runStep("lint",      "npx", ["eslint", ".", "--ext", ".ts,.tsx"]);
    runStep("test:translations", "npx",
        ["vitest", "run", "lib/__tests__/translations.test.ts"]);
}

function build() {
    section("build");
    runStep("next build", "npx", ["next", "build"]);
    const standalone = join(ROOT, ".next", "standalone", "server.js");
    if (!existsSync(standalone)) {
        throw new Error(
            ".next/standalone/server.js missing after build. Is next.config.ts output:'standalone'?",
        );
    }
}

function pack(restArgs = []) {
    section("pack");
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const sha   = gitShortSha();
    const outfile = restArgs[0]
        ? resolve(restArgs[0])
        : join(DIST, `ordo-nuntius-${sha}-${stamp}.tar.gz`);

    // Wipe dist/ before every pack so old tarballs and any leftover
    // stage-* dirs from interrupted runs don't accumulate. Without this,
    // each deploy added a new ~400MB tarball alongside the previous ones;
    // over time the directory grew to multi-GB and `deploy-ec2.sh`'s scp
    // step (which packs from dist/) ballooned correspondingly. If a
    // caller explicitly passed an outfile outside dist/ (e.g.
    // `pack /tmp/foo.tgz`), the cleanup only affects dist/ — their
    // chosen path is untouched.
    rmSync(DIST, { recursive: true, force: true });
    const stage = join(DIST, `stage-${stamp}`);
    mkdirSync(stage, { recursive: true });
    mkdirSync(DIST, { recursive: true });

    // next.js standalone layout: copy server + the bundled .next/ subtree.
    cpSync(join(ROOT, ".next", "standalone"), stage, { recursive: true });
    // Then layer in .next/static and public at the standalone root.
    mkdirSync(join(stage, ".next"), { recursive: true });
    cpSync(join(ROOT, ".next", "static"), join(stage, ".next", "static"),
        { recursive: true });
    cpSync(join(ROOT, "public"), join(stage, "public"), { recursive: true });

    // The install/ bundle is everything the host-side script needs.
    const installDst = join(stage, "install");
    mkdirSync(installDst, { recursive: true });
    cpSync(join(ROOT, "infra", "systemd", "ordonuntius.service.template"),
        join(installDst, "ordonuntius.service.template"));
    cpSync(join(ROOT, "infra", "nginx", "webmail.saltnlightllc.com.conf"),
        join(installDst, "webmail.saltnlightllc.com.conf"));
    cpSync(join(ROOT, "infra", "nginx", "connection-upgrade.conf"),
        join(installDst, "connection-upgrade.conf"));
    cpSync(join(ROOT, "infra", "scripts", "install-ordo-nuntius.sh"),
        join(installDst, "install-ordo-nuntius.sh"));

    writeFileSync(join(installDst, "RELEASE.json"), JSON.stringify({
        stamp, git_commit: sha,
        built_at: new Date().toISOString(),
        node: process.version,
    }, null, 2));

    // Precompress static text assets with brotli max-quality. nginx
    // brotli_static serves the .br variant directly, so requests pay
    // zero compression CPU and the wire payload is ~10-15% smaller than
    // on-the-fly brotli level 5. ~6KB saved on the largest CSS chunk,
    // proportional savings across every JS chunk. Done at pack time
    // (slow but one-shot) instead of build or request time.
    precompressBrotli(join(stage, ".next", "static"));
    precompressBrotli(join(stage, "public"));

    // --force-local: stop GNU tar from interpreting "C:\..." as host:path
    // (Windows-only quirk; harmless on Linux/macOS GNU tar).
    runStep("tar", "tar",
        ["--force-local", "-czf", outfile, "-C", stage, "."]);
    rmSync(stage, { recursive: true, force: true });

    const size = (statSync(outfile).size / 1024 / 1024).toFixed(1);
    console.log(`  -> ${outfile} (${size} MB)`);

    // Stash for deploy to pick up without rebuilding.
    writeFileSync(join(DIST, "LATEST"), outfile);
    return outfile;
}

function release() {
    section("release");
    // Wipe dist/ BEFORE verify+build runs, not just before pack writes a
    // new tarball. Why: if dist/ has a prior 80MB tarball when next build
    // executes, Next.js traces it into .next/standalone/dist/, and pack
    // then bundles that traced copy inside its own tarball — recursive
    // 80MB → 160MB → 320MB → ... bloat across deploy cycles. Wiping
    // here guarantees next build sees an empty dist/. The
    // `outputFileTracingExcludes` config in next.config.ts is a
    // defense-in-depth backup, but the empirical evidence is that
    // `output: "standalone"` arbitrary-root-copies sidestep it.
    rmSync(DIST, { recursive: true, force: true });
    verify();
    build();
    checkBundleBudget();
    return pack();
}

// ---------------------------------------------------------------------------
// checkBundleBudget — regression guard for per-chunk size
//
// Rationale: a previous regression had `components/providers/intl-provider.tsx`
// statically importing all 16 locale catalogs into one 1.83 MB client chunk
// that every user downloaded regardless of which locale they needed. The
// fix landed in commit 1f7b09d, but nothing prevents a future change from
// reintroducing the same shape. This check fails the release gate if any
// `.next/static/chunks/*.js` exceeds the threshold below, so a single
// inadvertent barrel-import or static-locale-catalog regression is caught
// before deploy rather than discovered when users complain.
//
// The threshold is generous on current state: largest legitimate chunk
// today is the lazy asn1js chunk at ~750 KB, and the largest legitimate
// entry-path chunk is ~227 KB. 1.5 MB leaves headroom for normal growth
// while catching the kind of accidental-barrel-import regressions that
// historically went unnoticed for weeks.
// ---------------------------------------------------------------------------

function checkBundleBudget() {
    section("bundle-budget");
    const chunksDir = join(ROOT, ".next", "static", "chunks");
    if (!existsSync(chunksDir)) {
        throw new Error(`bundle-budget: ${chunksDir} not found — did build run?`);
    }
    const overBudget = [];
    const stack = [chunksDir];
    let totalKb = 0;
    let count = 0;
    let largest = { path: "", kb: 0 };
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); }
        catch { continue; }
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory()) {
                stack.push(p);
            } else if (e.name.endsWith(".js")) {
                try {
                    const kb = statSync(p).size / 1024;
                    totalKb += kb;
                    count++;
                    if (kb > largest.kb) largest = { path: p, kb };
                    if (kb > CHUNK_SIZE_BUDGET_KB) {
                        overBudget.push({ path: p, kb });
                    }
                } catch { /* skip unreadable */ }
            }
        }
    }
    console.log(`  ${count} chunks, ${(totalKb / 1024).toFixed(1)} MB total`);
    console.log(`  largest: ${largest.path.replace(ROOT, "")} (${largest.kb.toFixed(0)} KB)`);
    console.log(`  budget:  ${CHUNK_SIZE_BUDGET_KB} KB per chunk`);
    if (overBudget.length > 0) {
        console.log(`  ✗ ${overBudget.length} chunk(s) over budget:`);
        for (const c of overBudget) {
            console.log(`    ${c.path.replace(ROOT, "")} (${c.kb.toFixed(0)} KB)`);
        }
        throw new Error(
            `bundle-budget: ${overBudget.length} chunk(s) exceed ${CHUNK_SIZE_BUDGET_KB} KB. ` +
            `Investigate with: grep -ao '[a-z]\\{4,\\}' <chunk> | sort -u | head -20  to identify what's inside. ` +
            `Common causes: a barrel import (entire library, not just used exports), ` +
            `static import of multi-locale message catalogs, or a previously-lazy ` +
            `module promoted to static.`,
        );
    }
    console.log(`  ✓ all chunks under budget`);
}

function deploy(restArgs = []) {
    const env = restArgs[0];
    const ssh = restArgs[1] || "ordo-epistola";
    if (!env || !["email-lab", "staging", "prod"].includes(env)) {
        throw new Error(
            "deploy: first argument must be one of email-lab | staging | prod",
        );
    }
    section(`deploy ${env} via ${ssh}`);
    release();

    // Hand off to the existing shell deploy. The shell script does the
    // rebuild itself; an alternative would be to pass the LATEST tarball
    // we just packed, but that's a refactor we don't need yet.
    const cmd = process.platform === "win32" ? "bash" : "bash";
    runStep("deploy-ec2.sh", cmd,
        [join(ROOT, "infra", "scripts", "deploy-ec2.sh"), env, ssh]);
}

// ---------------------------------------------------------------------------
// clean — wipe build outputs (NOT node_modules)
//
// Why: during the 2026-05-15 launch arc, `dist/` accumulated to 7.4GB
// across many builds (one tarball per `pack` invocation, never collected)
// and `.next/` to 8GB (turbopack incremental cache). Both caused
// deploy-ec2.sh's scp step to upload a multi-GB tarball that stalled.
// `pack` now self-cleans `dist/`; `clean` extends that to the other
// build outputs so an operator can baseline the tree before a release.
// ---------------------------------------------------------------------------

function clean() {
    section("clean");
    const targets = ["dist", ".next", "test-results", "tmp"];
    for (const t of targets) {
        const p = join(ROOT, t);
        const sizeMb = dirSizeMb(p);
        if (sizeMb === null) {
            console.log(`  - ${t}/ (absent)`);
            continue;
        }
        rmSync(p, { recursive: true, force: true });
        console.log(`  ✓ ${t}/ wiped (${sizeMb.toFixed(0)} MB freed)`);
    }
    console.log("\n  node_modules/ left intact — run `npm ci` if it's also wedged.");
}

// ---------------------------------------------------------------------------
// doctor — pre-flight check on the workstation before a deploy
//
// Each check is independent. A failed check prints both the diagnosis
// and the exact command to fix it, then doctor() exits non-zero. The
// goal is "one command tells you everything that's wrong" — operators
// don't need to remember the list of failure modes from runbooks.
//
// Checks today:
//   - node_modules/.bin/{tsc,eslint,next,vitest} symlinks present
//     (partial npm-install state breaks `npx tsc` etc.)
//   - dist/ size < 500MB (prevents repeating the 7GB upload incident)
//   - .next/ size < 2GB (turbopack cache bloat indicator)
//   - git working tree status (warns on uncommitted changes; not fatal)
//   - SSH alias `ec2` resolves (lightweight host-side reachability hint)
// ---------------------------------------------------------------------------

function doctor() {
    section("doctor");
    const issues = [];

    // 1. node_modules/.bin/* symlinks
    const requiredBins = ["tsc", "eslint", "next", "vitest"];
    for (const bin of requiredBins) {
        // Windows uses .CMD/.BAT shims, POSIX uses symlinks/scripts.
        const candidates = process.platform === "win32"
            ? [`${bin}.cmd`, bin, `${bin}.CMD`]
            : [bin];
        const found = candidates.some((c) => {
            try {
                lstatSync(join(ROOT, "node_modules", ".bin", c));
                return true;
            } catch { return false; }
        });
        if (!found) {
            issues.push({
                what: `node_modules/.bin/${bin} missing`,
                fix: "rm -rf node_modules && npm ci --no-audit --no-fund",
            });
        }
    }

    // 2. dist/ size
    const distMb = dirSizeMb(DIST);
    if (distMb !== null && distMb > 500) {
        issues.push({
            what: `dist/ is ${distMb.toFixed(0)} MB (>500 MB threshold)`,
            fix: "npm run xtask -- clean",
        });
    }

    // 3. .next/ size
    const nextMb = dirSizeMb(join(ROOT, ".next"));
    if (nextMb !== null && nextMb > 2000) {
        issues.push({
            what: `.next/ is ${nextMb.toFixed(0)} MB (>2 GB threshold)`,
            fix: "npm run xtask -- clean",
        });
    }

    // 4. git status (advisory, never fatal)
    let dirty = "";
    try {
        dirty = execSync("git status --porcelain", { cwd: ROOT })
            .toString().trim();
    } catch { /* git absent or not a repo — silently ignore */ }
    if (dirty) {
        const lines = dirty.split("\n").length;
        console.log(`  · git: ${lines} uncommitted change(s) — advisory, deploys ship from working tree.`);
    } else {
        console.log("  ✓ git: working tree clean");
    }

    // 5. ssh alias ec2 resolves
    const sshCheck = spawnSync(
        "ssh",
        ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "ec2",
         "echo ok"],
        { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32" },
    );
    if (sshCheck.status !== 0) {
        issues.push({
            what: "ssh alias `ec2` does not resolve / reach the host",
            fix: "add a Host ec2 stanza in ~/.ssh/config or check VPN/network",
        });
    }

    // Report
    if (issues.length === 0) {
        console.log("\n  ✓ all checks passed — safe to deploy.");
        return;
    }
    console.log("\n  Issues found:");
    for (const i of issues) {
        console.log(`  ✗ ${i.what}`);
        console.log(`    fix: ${i.fix}`);
    }
    throw new Error(`doctor: ${issues.length} issue(s) found — fix and re-run.`);
}

// Helper: directory size in MB, or null if the path doesn't exist.
function dirSizeMb(path) {
    if (!existsSync(path)) return null;
    let total = 0;
    const stack = [path];
    while (stack.length) {
        const p = stack.pop();
        let entries;
        try { entries = readdirSync(p, { withFileTypes: true }); }
        catch { continue; }
        for (const e of entries) {
            const child = join(p, e.name);
            try {
                if (e.isDirectory()) stack.push(child);
                else total += statSync(child).size;
            } catch { /* skip unreadable */ }
        }
    }
    return total / 1024 / 1024;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(name) {
    console.log(`\n[xtask] ${name}`);
}

function runStep(label, cmd, cmdArgs) {
    console.log(`  $ ${label}: ${cmd} ${cmdArgs.join(" ")}`);
    const result = spawnSync(cmd, cmdArgs, {
        cwd: ROOT, stdio: "inherit", shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        throw new Error(`${label} failed with exit code ${result.status}`);
    }
}

function gitShortSha() {
    try {
        return execSync("git rev-parse --short HEAD", { cwd: ROOT })
            .toString().trim();
    } catch {
        return "unknown";
    }
}

// ---------------------------------------------------------------------------
// check-dns — verify SES outbound DNS posture
// ---------------------------------------------------------------------------

async function checkDns(restArgs = []) {
    const mailDomain = restArgs[0] || "saltnlightllc.com";
    const mailHost   = restArgs[1] || `mail.${mailDomain}`;
    section(`check-dns ${mailDomain} (host: ${mailHost})`);

    const results = [];
    const record = (name, ok, detail) => {
        results.push({ name, ok, detail });
        const tag = ok === true ? "ok  " : ok === null ? "skip" : "FAIL";
        console.log(`  ${tag} ${name}: ${detail}`);
    };

    // 1. MX -> mail host
    try {
        const mx = await dns.resolveMx(mailDomain);
        const hosts = mx.map((r) => r.exchange.replace(/\.$/, ""));
        const hasTarget = hosts.some((h) => h === mailHost);
        record("MX",
            hasTarget,
            hasTarget ? `${hosts.join(", ")}` : `expected ${mailHost}, got [${hosts.join(", ")}]`);
    } catch (e) {
        record("MX", false, `lookup failed: ${e.code || e.message}`);
    }

    // 2. SPF (apex TXT containing v=spf1 ... amazonses.com ... -all/~all)
    try {
        const txt = (await dns.resolveTxt(mailDomain)).map((parts) => parts.join(""));
        const spf = txt.find((s) => s.startsWith("v=spf1"));
        if (!spf) {
            record("SPF", false, "no v=spf1 record on apex");
        } else {
            const includes = spf.includes("amazonses.com");
            const strict = /[\s]-all\b/.test(spf);
            record("SPF",
                includes && strict,
                strict ? spf : `${spf}  (missing -all)`);
        }
    } catch (e) {
        record("SPF", false, `lookup failed: ${e.code || e.message}`);
    }

    // 3. DMARC (_dmarc.<domain> TXT with v=DMARC1 and p=quarantine|reject)
    try {
        const txt = (await dns.resolveTxt(`_dmarc.${mailDomain}`)).map((p) => p.join(""));
        const dmarc = txt.find((s) => s.startsWith("v=DMARC1"));
        if (!dmarc) {
            record("DMARC", false, "no v=DMARC1 record at _dmarc");
        } else {
            const policy = (dmarc.match(/\bp=([a-zA-Z]+)/) || [, "none"])[1];
            const adequate = policy === "quarantine" || policy === "reject";
            record("DMARC",
                adequate,
                adequate ? dmarc : `p=${policy} (recommend quarantine or reject)`);
        }
    } catch (e) {
        record("DMARC", false, `lookup failed: ${e.code || e.message}`);
    }

    // 4. DKIM tokens (SES Easy DKIM publishes 3 CNAMEs of the form
    //    <token>._domainkey.<domain> -> <token>.dkim.amazonses.com).
    //    We can't enumerate tokens blindly; instead, query the 3 SES-issued
    //    tokens that the operator should supply. If unset, just probe whether
    //    ANY <something>._domainkey CNAMEs exist by trying the first character
    //    of each base32 alphabet — too noisy. Instead, document and skip.
    const tokens = (process.env.SES_DKIM_TOKENS || "").split(",")
        .map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) {
        record("DKIM",
            null,
            "SKIP — set SES_DKIM_TOKENS=t1,t2,t3 (from SES console) to check");
    } else {
        let ok = true; const detail = [];
        for (const token of tokens) {
            try {
                const cname = await dns.resolveCname(`${token}._domainkey.${mailDomain}`);
                const target = (cname[0] || "").replace(/\.$/, "");
                const expected = `${token}.dkim.amazonses.com`;
                if (target !== expected) {
                    ok = false;
                    detail.push(`${token}: -> ${target} (expected ${expected})`);
                } else {
                    detail.push(`${token}: ok`);
                }
            } catch (e) {
                ok = false;
                detail.push(`${token}: lookup failed (${e.code || e.message})`);
            }
        }
        record("DKIM", ok, detail.join("; "));
    }

    // 5. A record for the mail host
    try {
        const a = await dns.resolve4(mailHost);
        record("A", a.length > 0, a.join(", "));
    } catch (e) {
        record("A", false, `${mailHost} A lookup failed: ${e.code || e.message}`);
    }

    // Summary
    const failed = results.filter((r) => r.ok === false).length;
    const skipped = results.filter((r) => r.ok === null).length;
    const passed = results.filter((r) => r.ok === true).length;
    console.log(`\n  passed=${passed} failed=${failed} skipped=${skipped}`);
    if (failed > 0) {
        throw new Error("check-dns: one or more records failed");
    }
}
