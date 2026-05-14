# OrdoNuntius Infrastructure — Salt & Light email-lab

This directory deploys OrdoNuntius (Next.js standalone webmail) onto the
existing email-lab EC2 instance that already runs OrdoEpistola at
`mail.saltnlightllc.com`. The webmail is **co-located** with the mail
server, fronted by **nginx** terminating TLS on `:443`.

## Layout

```
infra/
  nginx/
    mail.saltnlightllc.com.conf        nginx site config; routes /jmap, /.well-known/*,
                                       /dav/, /api/{principal,domain,queue,report,store},
                                       /metrics/, oauth endpoints -> 127.0.0.1:8443 (OrdoEpistola),
                                       everything else -> 127.0.0.1:3000 (OrdoNuntius).
    connection-upgrade.conf             map $http_upgrade $connection_upgrade — required for
                                       JMAP EventSource / WebSocket forwarding.

  systemd/
    ordonuntius.service.template        systemd unit; rendered by install-ordo-nuntius.sh.

  scripts/
    install-ordo-nuntius.sh             runs on the EC2 host: reads SSM, renders env file,
                                       atomic-swap release symlink, installs unit + nginx
                                       site config, validates nginx, does NOT start.
    deploy-ec2.sh                       runs on operator workstation: npm ci + next build,
                                       packs .next/standalone + static + public + infra,
                                       scp to host, invokes install-ordo-nuntius.sh remotely.

  cloudformation/
    ordo-nuntius-iam.yaml               additive AWS resources: managed policy attaching
                                       /saltnlight/webmail/<env>/* SSM read to the existing
                                       OrdoEpistola instance role, CloudWatch log group,
                                       service-inactive alarm + composite degraded alarm.
                                       Does NOT create EC2.

  runbooks/
    nginx-cutover.md                    one-time procedure to insert nginx in front of
                                       OrdoEpistola (which currently binds :443 directly).
    restart-canary-webmail.md           per-deploy checklist + browser falsifier.
```

## Quick start

### One-time bootstrap (operator)

1. Stand up the SSM parameters:
   ```sh
   aws ssm put-parameter --region us-east-2 --type SecureString \
       --name /saltnlight/webmail/email-lab/session-secret \
       --value "$(openssl rand -base64 32)"
   # Optional — only if integrating with OrdoEpistola OAuth:
   aws ssm put-parameter --region us-east-2 --type SecureString \
       --name /saltnlight/webmail/email-lab/oauth/client-id     --value "<id>"
   aws ssm put-parameter --region us-east-2 --type SecureString \
       --name /saltnlight/webmail/email-lab/oauth/client-secret --value "<secret>"
   aws ssm put-parameter --region us-east-2 --type String \
       --name /saltnlight/webmail/email-lab/oauth/issuer-url    --value "https://mail.saltnlightllc.com"
   ```

2. Deploy the additive CloudFormation stack:
   ```sh
   aws cloudformation deploy --region us-east-2 \
       --template-file infra/cloudformation/ordo-nuntius-iam.yaml \
       --stack-name ordo-nuntius-email-lab \
       --capabilities CAPABILITY_NAMED_IAM \
       --parameter-overrides \
           Environment=email-lab \
           OrdoEpistolaInstanceRoleName=<role-name-from-ordoepistola-stack> \
           InstanceId=i-0a462d2c5eb1ba39e \
           AlertSnsTopicArn=arn:aws:sns:us-east-2:338071012635:legacy-locker-alerts
   ```

3. Run the nginx cutover (see `runbooks/nginx-cutover.md`). One-time.

4. Verify Node 24 is installed on the host:
   ```sh
   ssh ordo-epistola "node --version"   # expect v24.x
   # if absent:
   ssh ordo-epistola "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
   ```

### Each release (operator)

Use the local xtask runner — it gates `verify → build → pack` before the
network roundtrip, so a broken release fails fast on your workstation
instead of halfway through scp.

```sh
# From the OrdoNuntius repo root, with ~/.ssh/config aliasing 'ordo-epistola'
# to the email-lab box.
npm run xtask -- release            # local gate only (no deploy)
npm run xtask -- deploy email-lab   # release + scp + remote install

# Then on the host:
ssh ordo-epistola
sudo systemctl enable --now ordonuntius
sudo systemctl reload nginx

# Run the canary checklist.
cat /opt/ordonuntius/current/install/restart-canary-webmail.md
```

`infra/scripts/deploy-ec2.sh` is still the underlying mechanism and may be
invoked directly. The xtask wrapper adds the typecheck + lint + i18n test
gate around it and is the canonical entry point.

## SSM parameters consumed

| Parameter | Type | Used as | Required |
|---|---|---|---|
| `/saltnlight/webmail/<env>/session-secret` | SecureString | `SESSION_SECRET` | yes |
| `/saltnlight/webmail/<env>/oauth/client-id` | SecureString | `OAUTH_CLIENT_ID` | no |
| `/saltnlight/webmail/<env>/oauth/client-secret` | SecureString | `OAUTH_CLIENT_SECRET` | no |
| `/saltnlight/webmail/<env>/oauth/issuer-url` | String | `OAUTH_ISSUER_URL` | no |
| `/saltnlight/webmail/<env>/admin-password-hash` | SecureString | seed `admin.json` | no |

## Architectural decisions

- **Co-located on `email-lab-ordoepistola-01`**, not a separate instance.
  Cost ceiling (~$130/mo combined) does not justify a second t4g.large for
  webmail at <100 users. Failure-domain isolation is preserved at the
  process level via systemd + ulimits, not at the host level.
- **nginx + certbot**, not Caddy + ACM. Matches the existing
  `saltnlight-prod` convention; certbot already runs on this host.
- **scp-based deploy from operator workstation**, not CI to S3. Matches the
  existing `Saltnlight/deploy/deploy-ec2.sh` convention. CI is a roadmap item
  for after the first prod cutover.
- **Webmail talks JMAP via the public hostname**, not loopback. Preserves
  the exit option to split to a separate EC2 (candidate B in the roadmap)
  without re-touching `JMAP_SERVER_URL`.
- **OrdoEpistola listener moves to `127.0.0.1:8443`** (loopback HTTPS). Two
  TLS hops on loopback is wasteful but simpler than switching OrdoEpistola
  to cleartext-internal for one release. Optimize later if it ever matters.

## What this does NOT do

- Provision the EC2 instance — that's `OrdoEpistola/infra/cloudformation/ordo-epistola-ec2.yaml`.
- Run the build — Phase C (deferred) is a GitHub Action that builds in CI
  and uploads tarballs to S3. For now the operator builds locally.
- Manage DNS — `mail.saltnlightllc.com` already resolves to the email-lab
  box per `ops/aws.md`.
- Manage SES — OrdoEpistola owns the outbound SMTP path.
