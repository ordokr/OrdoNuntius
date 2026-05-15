#!/usr/bin/env bash
#
# install-ordo-nuntius.sh — install or update OrdoNuntius on an Ubuntu host.
#
# Run remotely by infra/scripts/deploy-ec2.sh after a release tarball has
# been extracted into the staging directory. Mirrors the structure of
# OrdoEpistola/infra/scripts/install-ordo-epistola.sh:
#
#   1. Verify env vars, system user, install dirs.
#   2. Pull SSM parameters under /saltnlight/webmail/<env>/* and render
#      /etc/ordonuntius/ordonuntius.env.
#   3. Atomically swap /opt/ordonuntius/current -> the new release.
#   4. Render and install the systemd unit + nginx site config.
#   5. nginx -t, systemctl daemon-reload, do NOT restart automatically —
#      the deploy thread runs the canary checklist and starts the unit.
#
# Required env vars (set by deploy-ec2.sh):
#   ORDO_NUNTIUS_ENV         email-lab | staging | prod
#   ORDO_NUNTIUS_HOSTNAME    public DNS hostname (mail.saltnlightllc.com)
#   ORDO_NUNTIUS_SSM_PREFIX  /saltnlight/webmail/<env>
#   ORDO_NUNTIUS_RELEASE_DIR staging dir containing the extracted release
#                            (must hold server.js, .next/static, public/, ...)

set -euo pipefail

err() { echo "[install-ordo-nuntius] error: $*" >&2; exit 1; }
log() { echo "[install-ordo-nuntius] $*"; }

###############################################################################
# 1. Preconditions
###############################################################################

[[ ${EUID} -eq 0 ]] || err "must run as root"
: "${ORDO_NUNTIUS_ENV:?missing}"
: "${ORDO_NUNTIUS_HOSTNAME:?missing}"
: "${ORDO_NUNTIUS_SSM_PREFIX:?missing}"
: "${ORDO_NUNTIUS_RELEASE_DIR:?missing}"

case "${ORDO_NUNTIUS_ENV}" in
    email-lab|staging|prod) ;;
    *) err "ORDO_NUNTIUS_ENV must be email-lab, staging, or prod (got '${ORDO_NUNTIUS_ENV}')" ;;
esac

APP_ROOT=${ORDO_NUNTIUS_APP_ROOT:-/opt/ordonuntius}
ETC_DIR=${ORDO_NUNTIUS_ETC_DIR:-/etc/ordonuntius}
STATE_DIR=${ORDO_NUNTIUS_STATE_DIR:-/var/lib/ordonuntius}
LOG_DIR=${ORDO_NUNTIUS_LOG_DIR:-/var/log/ordonuntius}
USER=${ORDO_NUNTIUS_USER:-ordonuntius}
GROUP=${ORDO_NUNTIUS_GROUP:-ordonuntius}
UNIT=/etc/systemd/system/ordonuntius.service
ENV_FILE=${ETC_DIR}/ordonuntius.env

RELEASE_DIR="${ORDO_NUNTIUS_RELEASE_DIR}"
[[ -d "${RELEASE_DIR}" ]]               || err "release dir not found: ${RELEASE_DIR}"
[[ -f "${RELEASE_DIR}/server.js" ]]     || err "server.js missing in release dir; was the next.js standalone build packaged correctly?"
[[ -d "${RELEASE_DIR}/.next/static" ]]  || err ".next/static missing in release dir"
[[ -d "${RELEASE_DIR}/public" ]]        || err "public/ missing in release dir"

INSTALL_DIR=${RELEASE_DIR}/install
UNIT_TEMPLATE=${INSTALL_DIR}/ordonuntius.service.template
NGINX_SITE_SRC=${INSTALL_DIR}/webmail.saltnlightllc.com.conf
NGINX_UPGRADE_SRC=${INSTALL_DIR}/connection-upgrade.conf
[[ -f "${UNIT_TEMPLATE}" ]]    || err "systemd unit template missing: ${UNIT_TEMPLATE}"
[[ -f "${NGINX_SITE_SRC}" ]]   || err "nginx site config missing: ${NGINX_SITE_SRC}"
[[ -f "${NGINX_UPGRADE_SRC}" ]]|| err "nginx connection-upgrade map missing: ${NGINX_UPGRADE_SRC}"

command -v aws       >/dev/null || err "aws CLI not installed"
command -v jq        >/dev/null || err "jq not installed"
command -v node      >/dev/null || err "node not installed (expect Node 24 LTS via NodeSource)"
command -v nginx     >/dev/null || err "nginx not installed"
NODE_BIN=$(command -v node)

node_major=$(node -p 'process.versions.node.split(".")[0]')
if (( node_major < 24 )); then
    err "node ${node_major} too old; need >= 24"
fi

###############################################################################
# 2. System user, directories
###############################################################################

if ! getent group "${GROUP}" >/dev/null; then
    groupadd --system "${GROUP}"
fi
if ! getent passwd "${USER}" >/dev/null; then
    useradd --system --gid "${GROUP}" --home-dir "${STATE_DIR}" \
        --shell /usr/sbin/nologin --no-create-home "${USER}"
fi

install -d -m 0750 -o "${USER}" -g "${GROUP}" "${ETC_DIR}"
install -d -m 0750 -o "${USER}" -g "${GROUP}" "${STATE_DIR}"
install -d -m 0750 -o "${USER}" -g "${GROUP}" "${LOG_DIR}"

# Admin config dir layout per OrdoNuntius spec — see .env.example.
install -d -m 0750 -o "${USER}" -g "${GROUP}" "${STATE_DIR}/admin"
install -d -m 0750 -o "${USER}" -g "${GROUP}" "${STATE_DIR}/admin-state"
install -d -m 0750 -o "${USER}" -g "${GROUP}" "${STATE_DIR}/settings"
install -d -m 0750 -o "${USER}" -g "${GROUP}" "${STATE_DIR}/telemetry"

install -d -m 0755                            "${APP_ROOT}"
install -d -m 0755                            "${APP_ROOT}/releases"

###############################################################################
# 3. Pull SSM parameters and render env file
###############################################################################

ssm_get() {
    local name="${ORDO_NUNTIUS_SSM_PREFIX%/}/$1"
    aws ssm get-parameter --name "${name}" --with-decryption \
        --query 'Parameter.Value' --output text 2>/dev/null
}

session_secret=$(ssm_get session-secret                || true)
oauth_client_id=$(ssm_get oauth/client-id              || true)
oauth_client_secret=$(ssm_get oauth/client-secret      || true)
oauth_issuer_url=$(ssm_get oauth/issuer-url            || true)
admin_password_hash=$(ssm_get admin-password-hash      || true)

if [[ -z "${session_secret}" ]]; then
    err "SSM parameter ${ORDO_NUNTIUS_SSM_PREFIX%/}/session-secret missing — populate it before installing"
fi

# OrdoNuntius runs on saltnlight-prod; OrdoEpistola JMAP lives on the
# separate email-lab box at mail.saltnlightllc.com. JMAP_SERVER_URL points
# cross-instance, not at this host.
cat > "${ENV_FILE}.tmp" <<EOF
# ${ENV_FILE}
# Rendered by install-ordo-nuntius.sh from SSM.
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000

APP_NAME=OrdoNuntius
# JMAP is served same-origin via the nginx proxy on this host. The browser
# only talks to webmail.saltnlightllc.com; nginx forwards JMAP/auth/well-known
# to mail.saltnlightllc.com server-side. Avoids the cross-origin CORS hazard
# (OrdoEpistola does not emit Access-Control-Allow-Origin response headers).
JMAP_SERVER_URL=${ORDO_NUNTIUS_JMAP_SERVER_URL:-https://${ORDO_NUNTIUS_HOSTNAME}}
STALWART_FEATURES=true

SESSION_SECRET=${session_secret}
SETTINGS_SYNC_ENABLED=true

ADMIN_CONFIG_DIR=${STATE_DIR}/admin
ADMIN_STATE_DIR=${STATE_DIR}/admin-state
SETTINGS_DATA_DIR=${STATE_DIR}/settings
TELEMETRY_DATA_DIR=${STATE_DIR}/telemetry

LOG_FORMAT=json
LOG_LEVEL=info

LOGIN_COMPANY_NAME=OrdoNuntius
LOGIN_LOGO_LIGHT_URL=/branding/OrdoNuntius_Logo_Color.svg
LOGIN_LOGO_DARK_URL=/branding/OrdoNuntius_Logo_Color.svg
LOGIN_WEBSITE_URL=https://saltnlightllc.com
EOF

if [[ -n "${oauth_client_id}" && -n "${oauth_client_secret}" && -n "${oauth_issuer_url}" ]]; then
    cat >> "${ENV_FILE}.tmp" <<EOF
OAUTH_ENABLED=true
OAUTH_CLIENT_ID=${oauth_client_id}
OAUTH_CLIENT_SECRET=${oauth_client_secret}
OAUTH_ISSUER_URL=${oauth_issuer_url}
EOF
fi

install -m 0640 -o "${USER}" -g "${GROUP}" "${ENV_FILE}.tmp" "${ENV_FILE}"
rm -f "${ENV_FILE}.tmp"

# Bootstrap admin password hash (if seeded in SSM). Setup wizard otherwise.
if [[ -n "${admin_password_hash}" ]] && [[ ! -f "${STATE_DIR}/admin/admin.json" ]]; then
    cat > "${STATE_DIR}/admin/admin.json" <<EOF
{ "passwordHash": "${admin_password_hash}" }
EOF
    chown "${USER}:${GROUP}" "${STATE_DIR}/admin/admin.json"
    chmod 0640 "${STATE_DIR}/admin/admin.json"
fi

###############################################################################
# 4. Atomic swap: releases/<stamp>/ -> current symlink
###############################################################################

STAMP=$(date +%Y%m%d%H%M%S)
NEW_RELEASE="${APP_ROOT}/releases/${STAMP}"
install -d -m 0755 -o "${USER}" -g "${GROUP}" "${NEW_RELEASE}"

# Copy the release contents. cp -a preserves perms; we then chown to ordonuntius.
cp -a "${RELEASE_DIR}/." "${NEW_RELEASE}/"
chown -R "${USER}:${GROUP}" "${NEW_RELEASE}"

# Swap the symlink atomically. ln -sfn updates an existing symlink in one op.
ln -sfn "${NEW_RELEASE}" "${APP_ROOT}/current.new"
mv -Tf "${APP_ROOT}/current.new" "${APP_ROOT}/current"

# Keep last 3 releases for fast rollback.
ls -1dt "${APP_ROOT}/releases/"*/ 2>/dev/null \
    | tail -n +4 \
    | xargs -r rm -rf

###############################################################################
# 5. Systemd unit
###############################################################################

sed -e "s|__NODE__|${NODE_BIN}|g" \
    -e "s|__APP_DIR__|${APP_ROOT}/current|g" \
    -e "s|__USER__|${USER}|g" \
    -e "s|__GROUP__|${GROUP}|g" \
    -e "s|__ENV_FILE__|${ENV_FILE}|g" \
    -e "s|__LOG_DIR__|${LOG_DIR}|g" \
    "${UNIT_TEMPLATE}" > "${UNIT}.tmp"
install -m 0644 "${UNIT}.tmp" "${UNIT}"
rm -f "${UNIT}.tmp"
systemctl daemon-reload

###############################################################################
# 6. Nginx site + connection-upgrade map
###############################################################################

# The site config and connection-upgrade map are environment-agnostic.
install -m 0644 "${NGINX_UPGRADE_SRC}" /etc/nginx/conf.d/connection-upgrade.conf
install -m 0644 "${NGINX_SITE_SRC}"    /etc/nginx/conf.d/webmail.saltnlightllc.com.conf

# Validate before activation. The deploy thread reloads nginx after starting
# the unit so a webmail crash on first launch doesn't break inbound mail.
nginx -t

###############################################################################
# 7. Done. Deploy thread starts the unit and reloads nginx.
###############################################################################

log "install-ordo-nuntius complete"
log "  app:       ${APP_ROOT}/current -> ${NEW_RELEASE}"
log "  env file:  ${ENV_FILE}"
log "  unit:      ${UNIT}"
log "  nginx:     /etc/nginx/conf.d/webmail.saltnlightllc.com.conf (validated, not reloaded)"
log ""
log "Service is NOT started. Deploy thread should now:"
log "  - 'systemctl enable --now ordonuntius'."
log "  - 'systemctl reload nginx'."
log "  - Run the restart canary (infra/runbooks/restart-canary-webmail.md)."
