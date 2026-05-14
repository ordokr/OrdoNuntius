<div align="center">

# OrdoNuntius

**The messenger client for OrdoEpistola.**
A JMAP-native webmail in the Ordo ecosystem.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL%20v3-blue.svg?logo=gnu&logoColor=white)](LICENSE)
[![Forked from](https://img.shields.io/badge/forked%20from-bulwarkmail%2Fwebmail-blue?logo=github&logoColor=white)](https://github.com/bulwarkmail/webmail)
[![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20React%2019%20%7C%20TypeScript-black?logo=next.js&logoColor=white)](https://nextjs.org/)

</div>

---

## What this is

**OrdoNuntius** (Latin: "messenger") is a modern, browser-based mail client for
the Ordo ecosystem. It connects to [OrdoEpistola](https://github.com/ordokr/OrdoEpistola)
(the mail server) via JMAP — the open IETF email protocol (RFC 8620) — and
provides mail, calendar, contacts, and file management.

In the Ordo namespace:

- **OrdoEpistola** — the letter (the server that holds and routes messages)
- **OrdoNuntius** — the messenger (this client; what users open in a browser)
- **OrdoDB** — the substrate database underlying both
- **OrdoAffine** — Notion-style docs (sister project, independent)

## Status

This is an early Ordo adaptation of the upstream **Bulwark Webmail** project.
Most of the application is unchanged from upstream — the rebrand is Layer 1
(naming, package metadata, fork lineage, default app branding) only. Deeper
Ordo-ecosystem integration (OrdoEpistola `x:` JMAP extension support, shared
authentication with OrdoAffine, custom theming) is roadmap work.

If you're looking for production webmail today, the upstream
[Bulwark Webmail](https://github.com/bulwarkmail/webmail) is the right place
to start. This fork is for the Ordo ecosystem specifically.

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19, Tailwind CSS 4, Radix UI primitives, Tiptap rich-text
- **State:** Zustand
- **Protocol:** JMAP (`jmap-client` / direct fetch via `/jmap` endpoint)
- **i18n:** next-intl, 15 languages
- **Crypto:** pkijs (S/MIME), otpauth (TOTP 2FA)
- **PWA:** dynamic manifest, configurable theming

## License

AGPL-3.0-only. See `LICENSE`. See `NOTICE` for full fork lineage including
upstream Bulwark (AGPL-3.0-only) and the earlier root-fr/jmap-webmail (MIT)
ancestor.

If you deploy OrdoNuntius as a public service to external users, AGPL requires
you to publish source for any modifications you make. For internal-only
deployments (single LLC, employees-only) the AGPL imposes no extra obligations
beyond MIT/Apache.

## Acknowledgements

OrdoNuntius is a fork of:

- **[Bulwark Webmail](https://github.com/bulwarkmail/webmail)** by the Bulwark
  Project Authors (rbm.systems). The vast majority of the code, design, and
  feature set is theirs. We've added the Ordo branding and ecosystem integration
  on top.
- **[root-fr/jmap-webmail](https://github.com/root-fr/jmap-webmail)** by
  Matthieu MALVACHE (MIT), the earlier ancestor that Bulwark forked from.

## Development

```bash
# Install deps
npm install

# Run dev server (Turbopack)
npm run dev

# Point at your OrdoEpistola instance
# Edit .env.development with:
#   APP_NAME=OrdoNuntius
#   JMAP_SERVER_URL=https://mail.<your-domain>/jmap
```

## Roadmap

**Layer 1 (done):** Rebrand — package metadata, manifest defaults, README, NOTICE, fork lineage, Bulwark Docker packaging removed in favor of native systemd on EC2.

**AWS launch (Salt & Light email-lab):** Webmail co-located with OrdoEpistola
on the email-lab EC2 at `mail.saltnlightllc.com`. nginx terminates TLS and
routes JMAP/.well-known/dav/metrics to OrdoEpistola on loopback :8443;
everything else to the Next.js standalone server on :3000. See
[`infra/README.md`](./infra/README.md) for the deploy procedure and the
[`infra/runbooks/`](./infra/runbooks) for the nginx cutover and the
per-deploy canary checklist.

**Layer 2:** OrdoEpistola JMAP `x:` extension support — surface admin features unique to the OrdoEpistola fork (`x:BlockedIp`, `x:Domain` management, etc.).

**Layer 3:** Shared authentication with OrdoAffine via OAuth/OIDC; cross-app navigation.

**Layer 4:** Ordo-themed component library to standardize look-and-feel across the ecosystem.

**CI:** Eventually replace operator-laptop `deploy-ec2.sh` with a GitHub Action
that builds the Next.js standalone tarball and uploads to S3. Deferred until
post-launch when deploy cadence justifies the pipeline.

---

For the upstream Bulwark Webmail documentation, features list, screenshots, and Docker deployment guide, see [bulwarkmail/webmail](https://github.com/bulwarkmail/webmail). This project will track upstream where practical.
