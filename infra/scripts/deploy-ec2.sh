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

STAMP="$(date +%Y%m%d%H%M%S)"
STAGE="$(mktemp -d -t "ordonuntius-release-${STAMP}.XXXXXX")"
ARCHIVE="${TMPDIR:-/tmp}/ordonuntius-release-${STAMP}.tgz"

cleanup() {
    rm -rf "${STAGE}" "${ARCHIVE}" 2>/dev/null || true
}
trap cleanup EXIT

echo "[deploy-ec2] env=${TARGET_ENV} host=${HOSTNAME} ssh=${TARGET}"
echo "[deploy-ec2] root=${ROOT}"
echo "[deploy-ec2] stage=${STAGE}"

cd "${ROOT}"

# 1. Build with next.js standalone output (already set in next.config.ts).
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
export GIT_COMMIT
echo "[deploy-ec2] building OrdoNuntius @ ${GIT_COMMIT}"
npm ci
npm run build

# next.js standalone layout:
#   .next/standalone/server.js + .next/standalone/.next/...
#   .next/static/   (must be placed at  standalone/.next/static)
#   public/         (must be placed at  standalone/public)
[[ -f .next/standalone/server.js ]] || {
    echo "deploy-ec2: .next/standalone/server.js missing; is next.config.ts output:'standalone'?" >&2
    exit 2
}
mkdir -p "${STAGE}"
cp -a .next/standalone/. "${STAGE}/"
mkdir -p "${STAGE}/.next"
cp -a .next/static "${STAGE}/.next/static"
cp -a public "${STAGE}/public"

# 2. Ship the infra scripts the install step needs.
mkdir -p "${STAGE}/install"
cp infra/systemd/ordonuntius.service.template     "${STAGE}/install/"
cp infra/nginx/webmail.saltnlightllc.com.conf     "${STAGE}/install/"
cp infra/nginx/connection-upgrade.conf            "${STAGE}/install/"
cp infra/scripts/install-ordo-nuntius.sh          "${STAGE}/install/"
chmod +x "${STAGE}/install/install-ordo-nuntius.sh"

# Record the deploy metadata for the About screen / audit.
cat > "${STAGE}/install/RELEASE.json" <<EOF
{
  "stamp": "${STAMP}",
  "git_commit": "${GIT_COMMIT}",
  "target_env": "${TARGET_ENV}",
  "hostname": "${HOSTNAME}"
}
EOF

# 3. Pack and ship.
tar -czf "${ARCHIVE}" -C "${STAGE}" .
echo "[deploy-ec2] archive: $(du -h "${ARCHIVE}" | cut -f1)"

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

echo "[deploy-ec2] release ${STAMP} installed on ${TARGET}; service NOT started."
echo "[deploy-ec2] next: SSH in, run the canary checklist, then enable+start."
