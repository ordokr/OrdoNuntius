# Runbook — insert nginx in front of OrdoEpistola (one-time cutover)

## What this is

OrdoEpistola currently binds `:443` directly on the email-lab EC2 instance
(`16.58.225.15`, `mail.saltnlightllc.com`). To co-host OrdoNuntius on the
same hostname we need nginx to terminate TLS on `:443` and forward HTTPS
traffic to either OrdoEpistola or OrdoNuntius based on URI.

**This is a one-time procedure.** It modifies the running mail server. Run
it in a low-traffic window. SMTP (25, 465, 587), IMAPS (993), and
ManageSieve (4190) are unaffected because they bypass nginx entirely.

## Prerequisites

- SSH access to the email-lab box (`ordo-epistola` alias).
- The existing Let's Encrypt cert at `/etc/letsencrypt/live/mail.saltnlightllc.com/`
  must be issued via webroot or DNS-01, not standalone. Standalone mode binds
  :80 itself and breaks during cutover. Verify with:
  ```sh
  sudo grep -E 'authenticator|webroot' /etc/letsencrypt/renewal/mail.saltnlightllc.com.conf
  ```
  If it says `authenticator = standalone`, migrate to webroot first:
  `sudo certbot certonly --webroot -w /var/www/letsencrypt -d mail.saltnlightllc.com`.
- A maintenance window. Realistic envelope: 5 minutes of HTTPS interruption.
- The current OrdoEpistola listener config backed up.

## Falsifier

After cutover, all of the following must pass:

1. `curl -sSf -o /dev/null https://mail.saltnlightllc.com/.well-known/jmap` returns 200.
2. `curl -sSf https://mail.saltnlightllc.com/metrics/prometheus -u prometheus-scraper:<pw>` returns metrics text.
3. `openssl s_client -connect mail.saltnlightllc.com:993 </dev/null` shows OrdoEpistola greeting (IMAPS untouched).
4. `swaks --server mail.saltnlightllc.com --port 587 --tls -t test@saltnlightllc.com` succeeds.
5. CloudWatch alarm `ordoepistola-email-lab-service-inactive` stays OK throughout.

If any fail, restore the listener config and `systemctl restart ordoepistola`.

## Procedure

### 1. Install nginx and prerequisites

```sh
sudo apt-get update
sudo apt-get install -y nginx jq

# Stop nginx until the configs are in place; default nginx site will
# conflict with port 80 once we set webroot.
sudo systemctl stop nginx

# Webroot for ACME renewals.
sudo install -d -m 0755 -o www-data -g www-data /var/www/letsencrypt
```

### 2. Reconfigure OrdoEpistola HTTPS listener to loopback :8443

OrdoEpistola's HTTPS listener lives in its datastore config under the
`server.listener.https` (or equivalent) key. The exact path depends on the
deployed version. Operator action:

1. Use the OrdoEpistola admin API or edit `/etc/ordoepistola/datastore.json`
   to change the HTTPS listener bind from `[::]:443` to `127.0.0.1:8443`.
2. Keep the TLS cert path identical — OrdoEpistola still serves HTTPS on
   the loopback, nginx is the public-facing TLS terminator. (Two TLS hops
   on loopback is wasteful but simpler than switching OrdoEpistola to
   cleartext for one release.)
3. Apply config:
   ```sh
   sudo systemctl reload ordoepistola
   ```
4. Verify OrdoEpistola is now on loopback :8443:
   ```sh
   sudo ss -tlnp | grep -E '8443|443'
   # expect: 127.0.0.1:8443 LISTEN ordoepistola; nothing on :443
   ```

### 3. Install the OrdoNuntius nginx site config

The `install-ordo-nuntius.sh` step does this automatically during deploy.
For the initial cutover *before* a first OrdoNuntius release exists, drop
the site config in by hand:

```sh
sudo install -m 0644 /path/to/OrdoNuntius/infra/nginx/connection-upgrade.conf \
    /etc/nginx/conf.d/connection-upgrade.conf
sudo install -m 0644 /path/to/OrdoNuntius/infra/nginx/mail.saltnlightllc.com.conf \
    /etc/nginx/conf.d/mail.saltnlightllc.com.conf

# OrdoNuntius isn't running yet — temporarily comment out the location /
# block (the Next.js catch-all) so nginx doesn't return 502 to humans.
# After OrdoNuntius is deployed, restore that block.

sudo nginx -t
```

### 4. Start nginx

```sh
sudo systemctl enable --now nginx
```

At this point, all JMAP / .well-known / metrics / dav / api endpoints are
served through nginx → loopback OrdoEpistola. SMTP / IMAPS / ManageSieve
remain direct.

### 5. Smoke

Run all five falsifier checks above. If any fail, rollback by:

```sh
# Restore OrdoEpistola to bind :443 directly.
# Edit /etc/ordoepistola/datastore.json back, then:
sudo systemctl stop nginx
sudo systemctl reload ordoepistola
sudo ss -tlnp | grep ':443'   # expect ordoepistola on :443
```

### 6. Update CloudWatch

The composite alarm `ordoepistola-email-lab-degraded` watches
`OrdoEpistolaServiceActive`. After cutover, add a second custom metric for
`NginxActive` so a future nginx crash also triggers the page-someone path.
Defer until the first OrdoNuntius release is deployed; nginx with no
backends is still useful for ACME renewals.

## After cutover

Future deploys go via `infra/scripts/deploy-ec2.sh email-lab`. That script
runs the install script which drops in the same nginx site config — so
running it twice is idempotent.

The `location /` block in `mail.saltnlightllc.com.conf` should be restored
once OrdoNuntius is ready (the first `deploy-ec2.sh` run handles this).
