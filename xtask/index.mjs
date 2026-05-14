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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const args = process.argv.slice(2);
const command = args[0] || "help";

const COMMANDS = {
    help, verify, build, pack, release, deploy,
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
