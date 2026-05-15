# Runbook — OAuth/OIDC wiring between OrdoNuntius and OrdoEpistola

## What this is

OrdoEpistola acts as the OAuth/OIDC IdP for OrdoNuntius. The two services
run on **different hosts**:

- OrdoNuntius (the OIDC client) — `webmail.saltnlightllc.com` (saltnlight-prod)
- OrdoEpistola (the IdP) — `mail.saltnlightllc.com` (email-lab box)

**CORS is handled by the nginx same-origin proxy.** The browser only
talks to `webmail.saltnlightllc.com`; nginx forwards JMAP, `/auth/*`, and
`/.well-known/*` requests to mail.saltnlightllc.com server-side. No CORS
headers are needed from OrdoEpistola, and no OrdoEpistola changes are
required to wire OAuth.

The OIDC `issuer` claim still resolves to `https://mail.saltnlightllc.com`
(OrdoEpistola's actual base URL — that's what it signs JWTs with). The
OrdoNuntius OIDC client must be configured with that issuer URL so its
discovery + JWKS verification points at the right authority.

## Step 1 — register OrdoNuntius as an OAuth client

From a machine with admin access to mail.saltnlightllc.com:

```sh
ADMIN=$(aws ssm get-parameter --region us-east-2 \
    --name /saltnlight/email/email-lab/stalwart/admin-bootstrap \
    --with-decryption --query 'Parameter.Value' --output text)

curl -sf -u "$ADMIN" \
    -H 'Content-Type: application/json' \
    -X POST https://mail.saltnlightllc.com/auth/register -d '{
        "client_name": "OrdoNuntius",
        "redirect_uris": [
            "https://webmail.saltnlightllc.com/api/auth/callback/ordoepistola"
        ],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "client_secret_basic",
        "scope": "openid offline_access urn:ietf:params:jmap:core urn:ietf:params:jmap:mail urn:ietf:params:jmap:submission"
    }'
```

Save the returned `client_id` and `client_secret`.

The redirect URI uses `webmail.saltnlightllc.com` (the actual public host
the browser ends up on); OrdoEpistola sees that URI and 302's the browser
back there at the end of the auth flow.

## Step 2 — populate OrdoNuntius SSM parameters

```sh
aws ssm put-parameter --region us-east-2 --type SecureString --overwrite \
    --name /saltnlight/webmail/email-lab/oauth/client-id \
    --value "<client_id from step 1>"

aws ssm put-parameter --region us-east-2 --type SecureString --overwrite \
    --name /saltnlight/webmail/email-lab/oauth/client-secret \
    --value "<client_secret from step 1>"

aws ssm put-parameter --region us-east-2 --type String --overwrite \
    --name /saltnlight/webmail/email-lab/oauth/issuer-url \
    --value "https://mail.saltnlightllc.com"
```

The issuer URL is the OrdoEpistola public base URL — that's what
OrdoEpistola embeds in JWTs as the `iss` claim. The OrdoNuntius server
fetches `<issuer>/.well-known/openid-configuration` to discover the
authorization/token endpoints. Those endpoints in the discovery doc
point at `mail.saltnlightllc.com/login` and `mail.saltnlightllc.com/auth/token`
— the browser hits the authorization URL directly (cross-domain
top-level navigation, no CORS), and OrdoNuntius's server-side code hits
the token URL (no browser involved, no CORS). The fetch-by-OrdoNuntius
of the discovery doc and JWKS also goes directly to mail., not via the
proxy.

(Aside: this means the `/login` URL on `mail.saltnlightllc.com` is what
the user sees during the auth dance, NOT `webmail.saltnlightllc.com/login`.
That's fine — the browser handles the top-level redirect; it's just a
different-hostname page in the same tab. The OrdoEpistola
`ORDO_EPISTOLA_OAUTH_LOGIN_SEGMENT` patch from earlier is not used in
this architecture.)

## Step 3 — redeploy OrdoNuntius

```sh
npm run xtask -- deploy email-lab
```

The install script picks up the new SSM params and writes them into
`/etc/ordonuntius/ordonuntius.env`.

## Falsifier (browser test)

1. Browse to `https://webmail.saltnlightllc.com/`. Login page loads.
2. Click "Sign in with OrdoEpistola" (or OAuth auto-starts if `OAUTH_ONLY=true`).
3. Browser navigates to
   `https://mail.saltnlightllc.com/login?response_type=code&client_id=...&redirect_uri=https%3A%2F%2Fwebmail.saltnlightllc.com%2Fapi%2Fauth%2Fcallback%2Fordoepistola&scope=openid+...&state=...`.
4. OrdoEpistola login form renders. Authenticate.
5. OrdoEpistola redirects to
   `https://webmail.saltnlightllc.com/api/auth/callback/ordoepistola?code=...&state=...`.
6. OrdoNuntius server-side exchanges the code at
   `https://mail.saltnlightllc.com/auth/token` (server-to-server,
   no CORS).
7. Inbox loads. JMAP requests in DevTools go to
   `https://webmail.saltnlightllc.com/jmap` (same-origin) and are
   forwarded by nginx to OrdoEpistola.

If step 7 shows JMAP requests going directly to `mail.saltnlightllc.com`
instead of through `webmail.saltnlightllc.com`, the `JMAP_SERVER_URL`
env was misrendered — it should be `https://webmail.saltnlightllc.com`,
not `https://mail.saltnlightllc.com`. Re-check
`/etc/ordonuntius/ordonuntius.env` on the host.

## Rollback to JMAP basic auth

```sh
aws ssm delete-parameter --region us-east-2 \
    --name /saltnlight/webmail/email-lab/oauth/client-id
aws ssm delete-parameter --region us-east-2 \
    --name /saltnlight/webmail/email-lab/oauth/client-secret
aws ssm delete-parameter --region us-east-2 \
    --name /saltnlight/webmail/email-lab/oauth/issuer-url
npm run xtask -- deploy email-lab
ssh ec2 sudo systemctl restart ordonuntius
```

OrdoNuntius falls back to its built-in username/password form. The user
types creds, OrdoNuntius makes JMAP requests with HTTP Basic — still
same-origin via the nginx proxy, so still no CORS issues.
