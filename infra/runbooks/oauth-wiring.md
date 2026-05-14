# Runbook — OAuth/OIDC wiring between OrdoNuntius and OrdoEpistola

## What this is

OrdoEpistola acts as the OAuth/OIDC IdP. OrdoNuntius is an OIDC client that
delegates the user-facing login flow to OrdoEpistola, exchanges the
authorization code for tokens server-side, and uses the access token to
make JMAP requests on the user's behalf.

Both services run on the same host (`email-lab-ordoepistola-01`,
`mail.saltnlightllc.com`). nginx in front terminates TLS and routes by URI.

## Prerequisite — OrdoEpistola supports a non-`/login` authorization path

The upstream OrdoEpistola hardcoded its OAuth authorization endpoint as
`{base_url}/login`. That collides with OrdoNuntius's own login page on the
same hostname. The OrdoEpistola fork at `ordokr/OrdoEpistola` commit
`2776d6ff` adds an env var `ORDO_EPISTOLA_OAUTH_LOGIN_SEGMENT` that picks
the first URL-path segment of the authorization endpoint (default
`"login"` — preserves upstream behavior; set to e.g. `"oauth-login"` to
free up `/login` for the webmail).

**Before running this runbook**, confirm the deployed OrdoEpistola binary
is at or beyond `2776d6ff` (`ordo-epistola --version` and grep
`OAuthConfig::login_path_segment` in symbols, or just check the deployed
git SHA from `ops/aws.md`). If the running binary is older, rebuild and
redeploy it first.

## Step 1 — Set the OrdoEpistola env var

Edit `/etc/ordoepistola/ordoepistola.env` on the host:

```sh
sudo nano /etc/ordoepistola/ordoepistola.env
```

Add:

```
ORDO_EPISTOLA_OAUTH_LOGIN_SEGMENT=oauth-login
```

Reload:

```sh
sudo systemctl restart ordoepistola
sleep 5
sudo systemctl is-active ordoepistola
```

Verify the metadata advertises the new path:

```sh
curl -sf https://mail.saltnlightllc.com/.well-known/openid-configuration \
    | python3 -c 'import json,sys; m=json.load(sys.stdin); print(m["authorization_endpoint"])'
# expect: https://mail.saltnlightllc.com/oauth-login
```

The legacy `/login` URL is preserved as a backstop — visiting it still
renders the same login HTML. The OIDC discovery doc just no longer
advertises it.

## Step 2 — Register OrdoNuntius as an OAuth client in OrdoEpistola

Three options. Pick one.

### Option 2a — Dynamic Client Registration (RFC 7591)

If OrdoEpistola has `anonymousClientRegistration=true` (check
`https://mail.saltnlightllc.com/.well-known/oauth-authorization-server`),
OrdoNuntius can register itself at boot. Nothing to do here — proceed to
Step 3 with empty `client-id` and `client-secret` SSM params, and the
OrdoNuntius login flow will register on first OAuth attempt.

### Option 2b — Manual registration via the OrdoEpistola admin API

Get an admin access token:

```sh
ADMIN_USER=$(aws ssm get-parameter --region us-east-2 \
    --name /saltnlight/email/email-lab/admin-bootstrap \
    --with-decryption --query 'Parameter.Value' --output text \
    | cut -d: -f1)
ADMIN_PASS=$(aws ssm get-parameter --region us-east-2 \
    --name /saltnlight/email/email-lab/admin-bootstrap \
    --with-decryption --query 'Parameter.Value' --output text \
    | cut -d: -f2-)

curl -sf -u "${ADMIN_USER}:${ADMIN_PASS}" \
    https://mail.saltnlightllc.com/auth/register \
    -X POST -H 'Content-Type: application/json' -d '{
        "client_name": "OrdoNuntius",
        "redirect_uris": [
            "https://mail.saltnlightllc.com/api/auth/callback/ordoepistola"
        ],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "client_secret_basic",
        "scope": "openid offline_access urn:ietf:params:jmap:core urn:ietf:params:jmap:mail urn:ietf:params:jmap:submission"
    }'
```

Save the returned `client_id` and `client_secret`.

### Option 2c — Pre-seed a client via OrdoEpistola admin UI

If the OrdoEpistola admin web UI is enabled (currently it is NOT — see
`infra/scripts/install-ordo-epistola.sh:160` which sets
`ORDO_EPISTOLA_WEBADMIN_DISABLED=1`), register through that. Otherwise
use Option 2a or 2b.

## Step 3 — Populate OrdoNuntius SSM parameters

```sh
aws ssm put-parameter --region us-east-2 --type SecureString --overwrite \
    --name /saltnlight/webmail/email-lab/oauth/client-id \
    --value "<client_id from step 2>"

aws ssm put-parameter --region us-east-2 --type SecureString --overwrite \
    --name /saltnlight/webmail/email-lab/oauth/client-secret \
    --value "<client_secret from step 2>"

aws ssm put-parameter --region us-east-2 --type String --overwrite \
    --name /saltnlight/webmail/email-lab/oauth/issuer-url \
    --value "https://mail.saltnlightllc.com"
```

The issuer URL is the OrdoEpistola public base URL. OrdoNuntius fetches
`<issuer-url>/.well-known/openid-configuration` to discover the auth /
token / userinfo / jwks endpoints — nginx routes all of these to
OrdoEpistola on `127.0.0.1:8443`.

## Step 4 — Redeploy OrdoNuntius

```sh
# From the OrdoNuntius repo on the operator workstation:
npm run xtask -- deploy email-lab
```

The install script picks up the new SSM params and writes them into
`/etc/ordonuntius/ordonuntius.env`. On restart, OrdoNuntius sees
`OAUTH_ENABLED=true`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and
`OAUTH_ISSUER_URL` and configures itself as an OIDC client of OrdoEpistola.

## Step 5 — Verify nginx routes the OIDC paths

The OrdoNuntius nginx site config
(`infra/nginx/mail.saltnlightllc.com.conf`) sends these to OrdoEpistola:

| URI | Target |
|---|---|
| `/.well-known/openid-configuration` | OrdoEpistola :8443 |
| `/.well-known/oauth-authorization-server` | OrdoEpistola :8443 |
| `/auth/token`, `/auth/introspect`, `/auth/userinfo`, `/auth/register`, `/auth/jwks.json`, `/auth/device` | OrdoEpistola :8443 |
| `/oauth-login` (configured authorization page) | OrdoEpistola :8443 |
| `/api/auth/callback/*` (OIDC callback) | OrdoNuntius :3000 (catch-all) |
| `/` and everything else | OrdoNuntius :3000 |

If you used a segment other than `oauth-login` in Step 1, edit the
`location = /oauth-login` block in
`infra/nginx/mail.saltnlightllc.com.conf` to match before deploying.

## Falsifier (browser test)

1. Browse to `https://mail.saltnlightllc.com/`. The OrdoNuntius login
   page loads with an "Sign in with OrdoEpistola" button (or the OAuth
   flow auto-starts, depending on `OAUTH_ONLY` setting).
2. Click sign-in. Browser redirects to
   `https://mail.saltnlightllc.com/oauth-login?response_type=code&client_id=...&redirect_uri=...&scope=openid+...&state=...`.
3. The OrdoEpistola login form renders. Enter `canary@saltnlightllc.com`
   credentials.
4. OrdoEpistola redirects back to
   `https://mail.saltnlightllc.com/api/auth/callback/ordoepistola?code=...&state=...`.
5. OrdoNuntius server-side exchanges the code at `/auth/token`, fetches
   userinfo, sets a session cookie, redirects to the inbox.
6. Inbox loads with the user's mail.

If steps 1-2 work but step 4 lands on a 502 or wrong app, the nginx
route-table is wrong — recheck the `location =` exact matches.

If step 5 fails with a token-exchange error, check that the `redirect_uri`
registered in Step 2 matches OrdoNuntius's actual callback URL exactly
(scheme + host + path).

## Rollback

To revert to JMAP basic auth:

```sh
aws ssm delete-parameter --region us-east-2 \
    --name /saltnlight/webmail/email-lab/oauth/client-id
aws ssm delete-parameter --region us-east-2 \
    --name /saltnlight/webmail/email-lab/oauth/client-secret
aws ssm delete-parameter --region us-east-2 \
    --name /saltnlight/webmail/email-lab/oauth/issuer-url
npm run xtask -- deploy email-lab
ssh ordo-epistola sudo systemctl restart ordonuntius
```

The install script omits the OAuth env block when those SSM params are
absent. OrdoNuntius falls back to its built-in username/password form,
which authenticates via HTTP Basic against JMAP — no OrdoEpistola side
changes needed for the rollback.
