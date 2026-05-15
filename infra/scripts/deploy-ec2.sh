#!/usr/bin/env bash
#
# deploy-ec2.sh — build OrdoNuntius locally, ship to the email-lab EC2 host,
# run install-ordo-nuntius.sh remotely.
#
# Usage:  infra/scripts/deploy-ec2.sh [target-env] [ssh-alias]
#
#   target-env   email-lab | staging | prod   (default: email-lab)
#   ssh-alias    SSH alias from ~/.ssh/config (default: ec2)
#
# Requires on the operator workstation:
#  - npm (Node 24+) on PATH; build runs locally before upload
#  - tar, scp, ssh
#  - An SSH alias configured for the target host with operator key access.
#    Concrete IPs and key paths live in ordokr/saltnlight-ops (private).
#
# Requires on the target host (as set up by the OrdoEpistola provisioning):
#  - aws CLI with instance profile permissions for ssm:GetParameter under
#    /saltnlight/webmail/<env>/*
#  - node 24+, nginx, jq
#  - certbot-issued cert at /etc/letsencrypt/live/mail.saltnlightllc.com/
#  - OrdoEpistola already reconfigured to bind 127.0.0.1:8443 for HTTPS
#    (one-time cutover; see infra/runbooks/nginx-cutover.md)

set -euo pipefail

TARGET_ENV="${1:-email-lab}"
TARGET="${2:-ec2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

case "${TARGET_ENV}" in
    email-lab|staging|prod) ;;
    *)
        echo "deploy-ec2.sh: target-env must be email-lab, staging, or prod (got '${TARGET_ENV}')" >&2
        exit 1
        ;;
esac

case "${TARGET_ENV}" in
    email-lab) HOSTNAME="webmail.saltnlightllc.com" ;;
    staging)   HOSTNAME="webmail-staging.saltnlightllc.com" ;;
    prod)      HOSTNAME="webmail.saltnlightllc.com" ;;
esac
SSM_PREFIX="/saltnlight/webmail/${TARGET_ENV}"

echo "[deploy-ec2] env=${TARGET_ENV} host=${HOSTNAME} ssh=${TARGET}"
echo "[deploy-ec2] root=${ROOT}"

cd "${ROOT}"

# 1. Locate the pre-built tarball produced by `xtask pack`.
#
# Previously this script did its own `npm ci && npm run build && tar`, which
# meant every `xtask deploy` rebuilt twice (once in xtask, once here) — a
# 60-120s waste per deploy. `xtask release` (the prerequisite for `xtask
# deploy`) already runs verify+build+pack and writes the tarball path to
# `dist/LATEST`. Read it from there.
#
# If LATEST is missing the operator either invoked this script directly
# without xtask, or the pack step failed. Either way the operator's fix is
# `npm run xtask -- pack` first — refuse rather than silently rebuild.
LATEST_POINTER="${ROOT}/dist/LATEST"
if [[ ! -f "${LATEST_POINTER}" ]]; then
    echo "deploy-ec2: ${LATEST_POINTER} missing." >&2
    echo "deploy-ec2: run \`npm run xtask -- pack\` first, or use \`npm run xtask -- deploy\`" >&2
    echo "deploy-ec2: which packs and then invokes this script." >&2
    exit 2
fi
PREBUILT_ARCHIVE=$(cat "${LATEST_POINTER}")
if [[ ! -f "${PREBUILT_ARCHIVE}" ]]; then
    echo "deploy-ec2: tarball ${PREBUILT_ARCHIVE} listed in LATEST not found." >&2
    echo "deploy-ec2: re-run \`npm run xtask -- pack\` to regenerate." >&2
    exit 2
fi

GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
echo "[deploy-ec2] using pre-built tarball $(basename "${PREBUILT_ARCHIVE}") @ ${GIT_COMMIT}"
echo "[deploy-ec2] tarball size: $(du -h "${PREBUILT_ARCHIVE}" | cut -f1)"

# Reuse the pre-built archive directly; no local rebuild, no tar reassembly.
ARCHIVE="${PREBUILT_ARCHIVE}"

scp "${ARCHIVE}" "${TARGET}:/tmp/ordonuntius-release.tgz"

# 4. Extract and run the install script on the remote host.
ssh "${TARGET}" \
    "TARGET_ENV='${TARGET_ENV}' HOSTNAME='${HOSTNAME}' SSM_PREFIX='${SSM_PREFIX}' bash -s" \
    <<'REMOTE'
set -euo pipefail

ARCHIVE=/tmp/ordonuntius-release.tgz
STAGING=/tmp/ordonuntius-release-staging
sudo rm -rf "${STAGING}"
sudo mkdir -p "${STAGING}"
sudo tar -xzf "${ARCHIVE}" -C "${STAGING}"

sudo \
    ORDO_NUNTIUS_ENV="${TARGET_ENV}" \
    ORDO_NUNTIUS_HOSTNAME="${HOSTNAME}" \
    ORDO_NUNTIUS_SSM_PREFIX="${SSM_PREFIX}" \
    ORDO_NUNTIUS_RELEASE_DIR="${STAGING}" \
    bash "${STAGING}/install/install-ordo-nuntius.sh"

sudo rm -f "${ARCHIVE}"
echo "[deploy-ec2 remote] install complete. Operator must now:"
echo "  sudo systemctl enable --now ordonuntius"
echo "  sudo systemctl reload nginx"
echo "  curl -sSf -o /dev/null https://${HOSTNAME}/ && echo OK"
REMOTE

echo "[deploy-ec2] release installed on ${TARGET} from $(basename "${ARCHIVE}"); service NOT started."
echo "[deploy-ec2] next: SSH in, run the canary checklist, then enable+start."
