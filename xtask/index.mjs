#!/usr/bin/env node
// xtask — local CI runner for OrdoNuntius.
//
// Mirrors the `cargo xtask <command>` pattern used by Rust-side Salt &
// Light projects. See xtask/README.md for the gate contract.
//
// No external deps — uses only node:child_process + node:fs + node:path.

import { spawnSync, execSync } from "node:child_process";
import {
    cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const args = process.argv.slice(2);
const command = args[0] || "help";

const COMMANDS = {
    help, verify, build, pack, release, deploy, "check-dns": checkDns,
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

See xtask/README.md for the gate contract.
`);
}

function verify() {
    section("verify");
    runStep("typecheck", "npx", ["tsc", "--noEmit"]);
    runStep("lint",      "npx", ["next", "lint"]);
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

    const stage = join(DIST, `stage-${stamp}`);
    rmSync(stage, { recursive: true, force: true });
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
    cpSync(join(ROOT, "infra", "nginx", "mail.saltnlightllc.com.conf"),
        join(installDst, "mail.saltnlightllc.com.conf"));
    cpSync(join(ROOT, "infra", "nginx", "connection-upgrade.conf"),
        join(installDst, "connection-upgrade.conf"));
    cpSync(join(ROOT, "infra", "scripts", "install-ordo-nuntius.sh"),
        join(installDst, "install-ordo-nuntius.sh"));

    writeFileSync(join(installDst, "RELEASE.json"), JSON.stringify({
        stamp, git_commit: sha,
        built_at: new Date().toISOString(),
        node: process.version,
    }, null, 2));

    runStep("tar", "tar",
        ["-czf", outfile, "-C", stage, "."]);
    rmSync(stage, { recursive: true, force: true });

    const size = (statSync(outfile).size / 1024 / 1024).toFixed(1);
    console.log(`  -> ${outfile} (${size} MB)`);

    // Stash for deploy to pick up without rebuilding.
    writeFileSync(join(DIST, "LATEST"), outfile);
    return outfile;
}

function release() {
    section("release");
    verify();
    build();
    return pack();
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
