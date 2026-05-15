# OrdoNuntius Infrastructure — Salt & Light

This directory deploys OrdoNuntius (Next.js standalone webmail) onto
**saltnlight-prod** (`i-0a7d30a49197243b1`, `16.58.52.6`, us-east-2)
alongside `hybridportalecosystem`. OrdoEpistola JMAP lives on a
**separate instance** (`email-lab-ordoepistola-01`, `16.58.225.15`); the
webmail talks to it cross-instance over the public hostname.

This architecture replaces the originally-considered co-located layout —
nginx + certbot + multi-service systemd are already in place on
saltnlight-prod, so no mail-server cutover is required. legacy-locker is
retired from saltnlight-prod as part of this migration (port 3000 is
reused for OrdoNuntius).

## Layout

```
infra/
  nginx/
    webmail.saltnlightllc.com.conf      TLS terminator + same-origin proxy.
                                        /jmap, /auth/*, /.well-known/openid-*
                                        forwarded to mail.saltnlightllc.com
                                        server-side so the browser sees only
                                        webmail.saltnlightllc.com (no CORS).
                                        Catch-all -> 127.0.0.1:3000 (Next.js).
    connection-upgrade.conf             map $http_upgrade $connection_upgrade.

  systemd/
    ordonuntius.service.template

  scripts/
    install-ordo-nuntius.sh             runs on the EC2 host
    deploy-ec2.sh                       runs on operator workstation (npm run xtask -- deploy)
    seed-ssm.sh                         populates /saltnlight/webmail/<env>/* SSM

  cloudformation/
    ordo-nuntius-iam.yaml               additive: SSM read managed policy
                                        attached to the saltnlight-prod
                                        instance role, CloudWatch log group,
                                        service-inactive alarm + composite
                                        with saltnlight-prod-cpu-high.

  runbooks/
    launch-checklist.md                 sequenced D->H operator runbook
    oauth-wiring.md                     optional OIDC client setup against
                                        mail.saltnlightllc.com IdP (CORS notes)
    restart-canary-webmail.md           per-deploy browser falsifier
    outbound-ses-check.md               SES verification + DNS + JMAP roundtrip
```

## Quick start

### One-time bootstrap (operator)

1. **DNS** — add A record `webmail.saltnlightllc.com -> 16.58.52.6` at the
   external DNS provider (TBD per `Saltnlight/ops/aws.md:248`).

2. **Retire legacy-locker** on the host (frees port 3000):

   ```sh
   ssh ec2 sudo bash -s <<'EOF'
   STAMP=$(date +%Y%m%d%H%M%S)
   sudo systemctl stop legacy-locker-webapp || true
   sudo systemctl disable legacy-locker-webapp || true
   sudo mkdir -p /opt/_archive
   sudo tar -czf /opt/_archive/legacy-locker-${STAMP}.tar.gz -C /opt legacy-locker || true
   sudo rm -rf /opt/legacy-locker /opt/legacy-locker.*
   sudo rm -f /etc/nginx/conf.d/legacy-locker.conf /etc/nginx/conf.d/legacy-locker.conf.bak.*
   sudo rm -f /etc/systemd/system/legacy-locker-webapp.service
   sudo systemctl daemon-reload
   sudo nginx -t && sudo systemctl reload nginx
   EOF
   ```

3. **Install Node 24** (currently v18.19.1 on the box):

   ```sh
   ssh ec2 sudo bash -s <<'EOF'
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version  # expect v24.x
   EOF
   ```

   ⚠ This upgrades Node globally. Verify `hybridportalecosystem.service`
   stays healthy after the upgrade — bounce the unit if needed.

4. **Issue cert** (DNS must already resolve):

   ```sh
   ssh ec2 sudo certbot certonly --webroot -w /var/www/letsencrypt \
       -d webmail.saltnlightllc.com -n --agree-tos -m timv@saltnlightllc.com
   ```

5. **Seed SSM**:

   ```sh
   infra/scripts/seed-ssm.sh email-lab
   ```

6. **Deploy the additive CloudFormation stack**:

   ```sh
   ROLE_NAME=$(aws iam list-roles --query \
       'Roles[?contains(RoleName, `saltnlight-prod`) || contains(RoleName, `legacy-locker`)].RoleName' \
       --output text | head -1)
   # Or look it up in the existing CFN stack outputs / IAM console.

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

7. (CORS handled by the nginx same-origin proxy — no OrdoEpistola
   changes needed. The browser only ever sees webmail.saltnlightllc.com.)

### Each release (operator)

```sh
npm run xtask -- release            # local gate only
npm run xtask -- deploy email-lab   # release + scp to ec2 + remote install

ssh ec2
sudo systemctl enable --now ordonuntius
sudo systemctl reload nginx
# Run the canary checklist:
cat /opt/ordonuntius/current/install/restart-canary-webmail.md
```

## SSM parameters consumed

| Parameter | Type | Used as | Required |
|---|---|---|---|
| `/saltnlight/webmail/<env>/session-secret` | SecureString | `SESSION_SECRET` | yes |
| `/saltnlight/webmail/<env>/oauth/client-id` | SecureString | `OAUTH_CLIENT_ID` | no |
| `/saltnlight/webmail/<env>/oauth/client-secret` | SecureString | `OAUTH_CLIENT_SECRET` | no |
| `/saltnlight/webmail/<env>/oauth/issuer-url` | String | `OAUTH_ISSUER_URL` | no |
| `/saltnlight/webmail/<env>/admin-password-hash` | SecureString | seed `admin.json` | no |

## Architectural decisions

- **On saltnlight-prod, not the email-lab box**. Failure-domain isolation
  preserved (webmail crash can't take down mail server). The pre-existing
  nginx + certbot + multi-app systemd pattern is reused without modifying
  the live mail box. legacy-locker retired from this host as part of the
  migration.
- **Cross-instance JMAP** at `https://mail.saltnlightllc.com`. Both
  instances are in `us-east-2c`; intra-AZ latency is sub-millisecond. The
  webmail traverses public-internet TLS to reach JMAP (same VPC, but
  through the public IP — could be optimized later via VPC endpoint).
- **`webmail.saltnlightllc.com`** as the hostname. legacy.saltnlightllc.com
  is decommissioned (returns 410 Gone via stub config, or 301-redirects
  if "Both" was chosen at launch time).
- **No OrdoEpistola changes required**: the previously-considered
  `/login` path collision is moot (different hostnames). The
  `ORDO_EPISTOLA_OAUTH_LOGIN_SEGMENT` patch on OrdoEpistola@2776d6ff
  remains shipped but unused for this deployment — harmless,
  backwards-compatible.
- **CORS is resolved by the nginx same-origin proxy**, not by
  OrdoEpistola config. OrdoEpistola does not emit
  Access-Control-Allow-Origin headers, so the browser cannot make
  cross-origin JMAP requests directly. nginx on this host forwards
  /jmap + /auth/* + /.well-known/openid-* to mail.saltnlightllc.com,
  letting the browser see same-origin throughout.

## What this does NOT do

- Provision the EC2 instance (already exists).
- Run the build (operator runs `npm run xtask -- deploy` locally).
- Manage DNS (the A record is external; manual operator action).
- Manage SES (OrdoEpistola owns the outbound SMTP path; see
  `infra/runbooks/outbound-ses-check.md`).
