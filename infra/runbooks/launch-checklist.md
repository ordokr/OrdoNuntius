# Runbook — OrdoNuntius launch checklist (lab → prod)

Single source-of-truth for taking OrdoNuntius from "nothing on the box"
to "users at `https://mail.saltnlightllc.com/` are reading and sending
mail." Sequences all the operator-side steps that the prior runbooks
each cover in isolation.

Pre-reads (cite as you go):

- `infra/runbooks/nginx-cutover.md` — one-time TLS/listener rearrangement
- `infra/runbooks/oauth-wiring.md` — optional OAuth IdP wiring
- `infra/runbooks/outbound-ses-check.md` — AWS SES verification
- `infra/runbooks/restart-canary-webmail.md` — per-deploy verification

Account context:

| | |
|---|---|
| AWS account | `338071012635` (Salt & Light LLC) |
| Region | `us-east-2` (Ohio) |
| Email-lab instance | `i-0a462d2c5eb1ba39e` (`16.58.225.15`, `mail.saltnlightllc.com`) |
| Email-lab role name | Look up in `OrdoEpistola` CFN outputs; the existing CFN stack's `InstanceRole` |
| SNS alert topic | `arn:aws:sns:us-east-2:338071012635:legacy-locker-alerts` |

## Phase D — AWS resources and SSM bootstrap

1. **Confirm OrdoEpistola binary is at or beyond `ordokr/OrdoEpistola@2776d6ff`**
   (the commit that adds `ORDO_EPISTOLA_OAUTH_LOGIN_SEGMENT`). If using
   JMAP basic auth and not OAuth, the binary version doesn't matter for
   launch; you can defer the rebuild. If OAuth is desired:

   ```sh
   ssh ordo-epistola "/opt/ordoepistola/bin/ordo-epistola --version 2>/dev/null; \
       cat /opt/ordoepistola/RELEASE 2>/dev/null || true"
   # then rebuild on-box if older (see Saltnlight/ops/runbooks/rebuild-ordoepistola-on-box.md)
   ```

2. **Populate SSM** (env vars first if you have prepared OAuth client
   creds; otherwise just session-secret):

   ```sh
   # session-secret only (JMAP basic auth path):
   infra/scripts/seed-ssm.sh email-lab

   # with OAuth (after going through oauth-wiring.md steps 1-2):
   OAUTH_CLIENT_ID=<from-step-2> \
   OAUTH_CLIENT_SECRET=<from-step-2> \
   OAUTH_ISSUER_URL=https://mail.saltnlightllc.com \
       infra/scripts/seed-ssm.sh email-lab
   ```

3. **Deploy the additive CloudFormation stack** (IAM + log group +
   alarms; no EC2 — that already exists):

   ```sh
   # First get the existing instance role name:
   ROLE_NAME=$(aws iam list-instance-profiles-for-role \
       --role-name $(aws ec2 describe-instances \
           --region us-east-2 --instance-ids i-0a462d2c5eb1ba39e \
           --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' \
           --output text | sed 's|.*instance-profile/||') \
       --query 'InstanceProfiles[0].Roles[0].RoleName' --output text 2>/dev/null) \
       || ROLE_NAME=<look-up-in-OrdoEpistola-CFN-outputs>

   aws cloudformation deploy --region us-east-2 \
       --template-file infra/cloudformation/ordo-nuntius-iam.yaml \
       --stack-name ordo-nuntius-email-lab \
       --capabilities CAPABILITY_NAMED_IAM \
       --parameter-overrides \
           Environment=email-lab \
           OrdoEpistolaInstanceRoleName="${ROLE_NAME}" \
           InstanceId=i-0a462d2c5eb1ba39e \
           AlertSnsTopicArn=arn:aws:sns:us-east-2:338071012635:legacy-locker-alerts
   ```

4. **Verify Node 24 on the host**:

   ```sh
   ssh ordo-epistola "node --version || echo 'not installed'"
   # If not installed:
   ssh ordo-epistola <<'EOF'
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version
   EOF
   ```

## Phase E — nginx cutover (one-time) and first deploy

1. **nginx cutover**: follow `infra/runbooks/nginx-cutover.md` end-to-end.
   This is the one bit that interrupts mail-server HTTPS traffic — ~5
   minutes. Don't skip the falsifier checks at the bottom of that runbook.

2. **First OrdoNuntius deploy** from the operator workstation:

   ```sh
   npm run xtask -- deploy email-lab
   ```

3. **Start the service and reload nginx** on the host:

   ```sh
   ssh ordo-epistola
   sudo systemctl enable --now ordonuntius
   sudo systemctl reload nginx
   ```

4. **Run the restart canary** (`infra/runbooks/restart-canary-webmail.md`).
   The browser falsifier at the bottom is the load-bearing check.

## Phase F — DNS and SES verification

The DNS records (MX, SPF, DMARC, DKIM) already exist for the OrdoEpistola
launch and aren't part of THIS launch's scope. Re-verify them anyway:

```sh
SES_DKIM_TOKENS=$(aws ses get-identity-dkim-attributes --region us-east-2 \
    --identities saltnlightllc.com \
    --query 'DkimAttributes."saltnlightllc.com".DkimTokens' --output text \
    | tr '\t' ',')
SES_DKIM_TOKENS="$SES_DKIM_TOKENS" npm run xtask -- check-dns
```

Full procedure: `infra/runbooks/outbound-ses-check.md`.

If anything fails, **stop** — don't promote anything to staging/prod
with bad outbound DNS. Fix the DNS first.

## Phase G — Staging and production

The email-lab boundary is the only environment active today. Staging and
production are template parameters in the CFN; they don't have
infrastructure yet. When ready:

1. **Spin up a staging EC2** (mirror of the email-lab instance, separate
   subnet). Author follows OrdoEpistola's CFN pattern at
   `OrdoEpistola/infra/cloudformation/ordo-epistola-ec2.yaml`.
2. **Seed SSM for staging**: `infra/scripts/seed-ssm.sh staging`.
3. **Deploy the additive stack**: as in Phase D step 3, with
   `Environment=staging`, the new instance id, and the staging instance
   role name.
4. **Deploy webmail**: `npm run xtask -- deploy staging <ssh-alias>` (set
   up the alias in `~/.ssh/config` first).
5. **Run the canary** in staging.
6. **Cut DNS** for `mail-staging.saltnlightllc.com` to the staging IP.

Production is the same procedure with `Environment=prod` and a third
EC2. We're not there yet — the email-lab boundary is the production
service for now, per `Saltnlight/ops/aws.md:43-58`.

## Phase H — Ops glue

After the first 24h soak:

1. **Add OrdoNuntius to the DLM backup policy** (currently targets
   `Project=legacy-locker` only — extend the tag filter or add a second
   policy targeting the email-lab instance). See
   `Saltnlight/ops/aws.md:124-138`.
2. **Confirm CloudWatch alarms are routing**:

   ```sh
   aws cloudwatch describe-alarms --region us-east-2 \
       --alarm-name-prefix ordonuntius-email-lab \
       --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Actions:AlarmActions}' \
       --output table
   ```

3. **Set up the unified-cloudwatch-agent metric publisher** on the host
   to emit `OrdoNuntiusServiceActive` (1/0 based on `systemctl is-active
   ordonuntius`). Mirrors the OrdoEpistola publisher already running.
   Drop-in to `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.d/`.
4. **Decide telemetry posture**: the OrdoNuntius anonymous telemetry is
   on by default. For Salt & Light's private-instance posture, set
   `ORDO_NUNTIUS_TELEMETRY=off` in `/etc/ordonuntius/ordonuntius.env` if
   you prefer no outbound heartbeat.
5. **Update the live-state baseline doc**
   (`Saltnlight/ops/live-state-baseline-2026-05-06.md`) to reflect that
   OrdoNuntius is live on the email-lab box at
   `https://mail.saltnlightllc.com/`.
6. **Update repo map** (`Saltnlight/ops/repos.md`) to add OrdoNuntius.

## Rollback (whole-launch)

If the launch needs to be rolled back entirely:

```sh
# 1. Stop OrdoNuntius and remove its nginx route.
ssh ordo-epistola <<'EOF'
sudo systemctl disable --now ordonuntius
sudo rm /etc/nginx/conf.d/mail.saltnlightllc.com.conf
sudo rm /etc/nginx/conf.d/connection-upgrade.conf
sudo nginx -t && sudo systemctl reload nginx
EOF

# 2. Revert OrdoEpistola to bind :443 directly (reverse the
#    nginx-cutover.md procedure). After this, mail-server HTTPS is
#    served directly again, no nginx fronting.

# 3. Tear down the additive CFN stack.
aws cloudformation delete-stack --region us-east-2 \
    --stack-name ordo-nuntius-email-lab
```

The OrdoEpistola mail server stays running throughout — webmail rollback
does NOT touch SMTP/IMAPS/JMAP.

## Status grid

Track in the issue or PR that ships v1:

| Phase | Owner | Done | Notes |
|---|---|---|---|
| D1 — OAuth wiring decision | | | JMAP basic auth or OAuth |
| D2 — SSM seeded | | | `seed-ssm.sh email-lab` |
| D3 — Additive CFN deployed | | | `ordo-nuntius-email-lab` stack |
| D4 — Node 24 on host | | | |
| E1 — nginx cutover | | | Falsifier passed |
| E2 — First xtask deploy | | | tarball stamp |
| E3 — Restart canary | | | Browser falsifier passed |
| F — Outbound SES check | | | check-dns passed |
| G — Staging | | | Not yet (lab is prod) |
| H — Ops glue | | | DLM, CW, telemetry, docs |
