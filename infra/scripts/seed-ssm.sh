#!/usr/bin/env bash
#
# seed-ssm.sh — populate the /saltnlight/webmail/<env>/* SSM parameters
# that install-ordo-nuntius.sh reads on the host. Idempotent — uses
# put-parameter --overwrite for values you set, and skips empty inputs.
#
# Usage:
#   infra/scripts/seed-ssm.sh <env>
#
#   env  email-lab | staging | prod
#
# Requires AWS CLI configured for the Salt & Light account
# (338071012635, us-east-2). Run from an operator workstation, not the
# email-lab box.

set -euo pipefail

err() { echo "[seed-ssm] error: $*" >&2; exit 1; }
log() { echo "[seed-ssm] $*"; }

ENV="${1:-}"
case "${ENV}" in
    email-lab|staging|prod) ;;
    *) err "first arg must be email-lab | staging | prod (got '${ENV:-<empty>}')" ;;
esac

REGION="us-east-2"
PREFIX="/saltnlight/webmail/${ENV}"

put_secure() {
    local name="$1" value="$2"
    if [[ -z "${value}" ]]; then return; fi
    aws ssm put-parameter --region "${REGION}" --overwrite \
        --type SecureString \
        --name "${PREFIX}/${name}" \
        --value "${value}" >/dev/null
    log "set SecureString ${PREFIX}/${name}"
}

put_string() {
    local name="$1" value="$2"
    if [[ -z "${value}" ]]; then return; fi
    aws ssm put-parameter --region "${REGION}" --overwrite \
        --type String \
        --name "${PREFIX}/${name}" \
        --value "${value}" >/dev/null
    log "set String ${PREFIX}/${name}"
}

# 1. Session secret — mandatory.
if aws ssm get-parameter --region "${REGION}" \
        --name "${PREFIX}/session-secret" --with-decryption \
        >/dev/null 2>&1; then
    log "session-secret already exists; keeping (use rotate-secrets runbook to rotate)"
else
    SECRET=$(openssl rand -base64 32)
    put_secure session-secret "${SECRET}"
fi

# 2. Admin password hash — optional. If you have one prepared by the
#    OrdoNuntius setup wizard offline, set ADMIN_PASSWORD_HASH in the
#    environment before running this script.
put_secure admin-password-hash "${ADMIN_PASSWORD_HASH:-}"

# 3. OAuth — optional. Set OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET /
#    OAUTH_ISSUER_URL in the environment when you're ready to wire OIDC
#    (see infra/runbooks/oauth-wiring.md). If empty, the install script
#    omits the OAuth block and OrdoNuntius falls back to JMAP basic auth.
put_secure oauth/client-id     "${OAUTH_CLIENT_ID:-}"
put_secure oauth/client-secret "${OAUTH_CLIENT_SECRET:-}"
put_string oauth/issuer-url    "${OAUTH_ISSUER_URL:-}"

log "done. To list everything under ${PREFIX}:"
log "  aws ssm get-parameters-by-path --region ${REGION} --path ${PREFIX} --recursive --with-decryption"
