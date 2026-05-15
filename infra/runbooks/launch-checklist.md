# Runbook — OrdoNuntius launch checklist (saltnlight-prod)

Single sequencing doc for the end-to-end launch. Target architecture:

- OrdoNuntius runs on `saltnlight-prod` (`i-0a7d30a49197243b1`, `16.58.52.6`)
- Public URL: `https://webmail.saltnlightllc.com/`
- JMAP server: `https://mail.saltnlightllc.com` (separate EC2 — `email-lab-ordoepistola-01`)
- legacy-locker is retired from this host as part of the launch

Pre-reads:

- `infra/runbooks/oauth-wiring.md` — optional OIDC client setup (cross-origin CORS)
- `infra/runbooks/outbound-ses-check.md` — SES verification
- `infra/runbooks/restart-canary-webmail.md` — per-deploy verification
- `infra/runbooks/lessons-learned-2026-05-15.md` — failure-mode appendix
  (X-Forwarded-Proto/EPROTO, `/.well-known/jmap` 307, cache-poisoning 301s,
  retry-budget math, lenient inbox auto-select, build-output hygiene,
  AWS/DNS gotchas, prod-visible diagnostic conventions)

## Phase D — host prep and AWS bootstrap

### D1. Add DNS A record

External DNS provider (per `Saltnlight/ops/aws.md:248`, not Route53):

```
webmail.saltnlightllc.com.   IN  A   16.58.52.6
```

Verify propagation before continuing:

```sh
dig +short webmail.saltnlightllc.com
# expect: 16.58.52.6
```

### D2. Retire legacy-locker on the host

```sh
ssh ec2 sudo bash -s <<'EOF'
set -euo pipefail
STAMP=$(date +%Y%m%d%H%M%S)
echo "[retire] stop+disable"
systemctl stop legacy-locker-webapp || true
systemctl disable legacy-locker-webapp || true

echo "[retire] archive"
install -d -m 0755 /opt/_archive
tar -czf /opt/_archive/legacy-locker-${STAMP}.tar.gz \
    -C /opt legacy-locker 2>/dev/null || \
    echo "(no /opt/legacy-locker to archive)"

echo "[retire] remove on-disk artifacts"
rm -rf /opt/legacy-locker /opt/legacy-locker.*
rm -f /etc/nginx/conf.d/legacy-locker.conf
rm -f /etc/nginx/conf.d/legacy-locker.conf.bak.*
rm -f /etc/systemd/system/legacy-locker-webapp.service
rm -f /etc/systemd/system/multi-user.target.wants/legacy-locker-webapp.service

systemctl daemon-reload
nginx -t
systemctl reload nginx
echo "[retire] complete; port 3000 freed"
ss -tlnp | grep -E ':3000\b' || echo "port 3000 not bound"
EOF
```

The cert at `/etc/letsencrypt/live/legacy.saltnlightllc.com/` is left in
place — cheap, supports a future `legacy.saltnlightllc.com -> webmail`
301 if needed. Auto-renewal continues until removed.

### D3. Install Node 24

```sh
ssh ec2 sudo bash -s <<'EOF'
set -euo pipefail
node --version  # expected: v18.19.1 (current)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
node --version  # expected: v24.x
EOF
```

Verify `hybridportalecosystem.service` is still healthy after the
upgrade:

```sh
ssh ec2 'sudo systemctl is-active hybridportalecosystem && \
    curl -fsS http://127.0.0.1:8080/api/health'
```

If `hybridportalecosystem` is broken by the Node 24 upgrade, restore by
installing Node 18 in parallel and switching the systemd unit's
`ExecStart` to use the explicit path. Do NOT proceed if the portal is
down — that's customer-impacting.

### D4. Issue Let's Encrypt cert for webmail.saltnlightllc.com

```sh
ssh ec2 sudo certbot certonly --webroot \
    -w /var/www/letsencrypt \
    -d webmail.saltnlightllc.com \
    -n --agree-tos -m timv@saltnlightllc.com
```

### D5. Seed SSM parameters

From the operator workstation with AWS CLI configured:

```sh
infra/scripts/seed-ssm.sh email-lab
```

If wiring OAuth at launch (optional), pre-set the env vars first; see
`infra/runbooks/oauth-wiring.md`.

### D6. Deploy the additive CloudFormation stack

```sh
# Locate the existing IAM role attached to saltnlight-prod:
ROLE_NAME=$(aws iam list-instance-profiles --region us-east-2 \
    --query 'InstanceProfiles[?contains(InstanceProfileName, `prod`) || contains(InstanceProfileName, `legacy`)].Roles[0].RoleName' \
    --output text | head -1)
# Verify:
echo "$ROLE_NAME"
# If empty, look it up in the console under EC2 -> i-0a7d30a49197243b1 -> IAM Role.

aws cloudformation deploy --region us-east-2 \
    --template-file infra/cloudformation/ordo-nuntius-iam.yaml \
    --stack-name ordo-nuntius-prod \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        Environment=email-lab \
        HostInstanceRoleName="${ROLE_NAME}" \
        InstanceId=i-0a7d30a49197243b1 \
        AlertSnsTopicArn=arn:aws:sns:us-east-2:338071012635:legacy-locker-alerts
```

## Phase E — deploy and verify

### E1. Build + ship + install

From the operator workstation:

```sh
npm run xtask -- deploy email-lab
```

This runs verify → build → pack → scp to `ec2` → invokes the install
script remotely. The install does NOT start the service; that's the
next step.

### E2. Start the service and reload nginx

```sh
ssh ec2 sudo bash -s <<'EOF'
systemctl enable --now ordonuntius
sleep 3
systemctl is-active ordonuntius || { journalctl -u ordonuntius -n 60; exit 1; }
nginx -t
systemctl reload nginx
EOF
```

### E3. Restart canary

Follow `infra/runbooks/restart-canary-webmail.md`. The browser falsifier
at the bottom of that runbook is the load-bearing check.

### E4. (Optional) OAuth wiring

If wiring OAuth at launch, follow `infra/runbooks/oauth-wiring.md`. No
OrdoEpistola server-side changes are needed for OAuth or for the basic
JMAP cross-instance traffic — nginx handles the same-origin proxy.

## Phase F — outbound SES verification

```sh
SES_DKIM_TOKENS=$(aws ses get-identity-dkim-attributes --region us-east-2 \
    --identities saltnlightllc.com \
    --query 'DkimAttributes."saltnlightllc.com".DkimTokens' --output text \
    | tr '\t' ',')
SES_DKIM_TOKENS="$SES_DKIM_TOKENS" npm run xtask -- check-dns
```

Full procedure: `infra/runbooks/outbound-ses-check.md`.

## Phase G — staging and production

Production is the email-lab boundary for now (per
`Saltnlight/ops/aws.md:43-58`). Webmail launches into that same
boundary on `saltnlight-prod`. There is no separate staging/prod tier;
the email-lab boundary IS the production service for v1.

Future staging/prod split: parameterize `Environment` to `staging` /
`prod` in seed-ssm + CFN, and spin up additional EC2 boxes when justified.

## Phase H — ops glue

After the first 24h soak:

1. **DLM backup** — saltnlight-prod is already covered by
   `policy-004f8cbe5f5968638` (targets `Project=legacy-locker`).
   OrdoNuntius state lives in `/var/lib/ordonuntius` on the same root EBS,
   so it's already in the snapshots.
2. **CloudWatch agent** — add the `OrdoNuntiusServiceActive` custom
   metric publisher to the existing unified-cloudwatch-agent config on
   saltnlight-prod (mirrors the OrdoEpistola publisher pattern in
   `Saltnlight/ops/aws.md:158-179`).
3. **Telemetry posture** — decide whether to keep the anonymous
   telemetry on (default) or set `ORDO_NUNTIUS_TELEMETRY=off` in
   `/etc/ordonuntius/ordonuntius.env`.
4. **Update docs**:
   - `Saltnlight/ops/repos.md` — add OrdoNuntius row, note legacy-locker
     retirement.
   - `Saltnlight/ops/aws.md` — section "Production instance:
     saltnlight-prod" service table now lists `ordonuntius.service`
     instead of `legacy-locker-webapp.service`.
   - `Saltnlight/ops/live-state-baseline-*.md` — bump baseline date,
     note that `https://webmail.saltnlightllc.com/` is live.

## Rollback (whole-launch)

If the launch needs to be rolled back entirely:

```sh
ssh ec2 sudo bash -s <<'EOF'
systemctl disable --now ordonuntius
rm -f /etc/nginx/conf.d/webmail.saltnlightllc.com.conf
rm -f /etc/nginx/conf.d/connection-upgrade.conf
nginx -t && systemctl reload nginx
EOF

# Tear down the additive CFN stack:
aws cloudformation delete-stack --region us-east-2 \
    --stack-name ordo-nuntius-prod

# Restore legacy-locker from archive (if a regression test catches an
# unforeseen dependency on it):
ssh ec2 sudo bash -s <<'EOF'
LATEST=$(ls -1t /opt/_archive/legacy-locker-*.tar.gz | head -1)
sudo tar -xzf "$LATEST" -C /opt
# Hand-restore systemd unit + nginx config (look in archive or git history)
EOF
```

The OrdoEpistola mail server is **never touched** by this launch or its
rollback — it's on a separate EC2 instance.

## Status grid

Track in the PR that ships v1:

| Phase | Owner | Done | Notes |
|---|---|---|---|
| D1 — DNS A added | | | `dig +short webmail.saltnlightllc.com -> 16.58.52.6` |
| D2 — legacy-locker retired | | | Archive stamp recorded |
| D3 — Node 24 installed | | | Portal still healthy after upgrade |
| D4 — Cert issued | | | `/etc/letsencrypt/live/webmail.saltnlightllc.com/` |
| D5 — SSM seeded | | | session-secret created |
| D6 — CFN deployed | | | `ordo-nuntius-prod` stack |
| E1 — xtask deploy | | | Tarball stamp |
| E2 — Service + nginx reload | | | `systemctl is-active ordonuntius` |
| E3 — Restart canary | | | Browser falsifier passed |
| E4 — OrdoEpistola CORS | | | (if OAuth wired) |
| F — Outbound SES check | | | check-dns passed |
| H — Ops glue | | | DLM (already covered), CW agent, docs |
