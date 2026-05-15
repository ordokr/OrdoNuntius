# Runbook — OrdoNuntius restart canary

Mirrors `OrdoEpistola/infra/runbooks/restart-canary.md` for the webmail unit.
Run this **after every `deploy-ec2.sh` invocation** before letting the
service take user traffic.

## Falsifier (end-user observable)

A real browser on the operator workstation can:

1. Load `https://webmail.saltnlightllc.com/` and see the OrdoNuntius login
   page with the OrdoNuntius logo (NOT the generic Bulwark page; verify
   branding loaded).
2. Log in with a Salt & Light test account (`canary@saltnlightllc.com`).
3. Read the most recent inbox message (any non-empty body, no 502).
4. Compose and send a reply to self; see the new message appear in Sent.
5. See the message arrive in Inbox within 30 seconds (round-trip via
   OrdoEpistola SMTP / IMAP).

If any of (1)–(5) fail, **rollback immediately** (see below) rather than
debug forward. Production users see the same failures you see.

## Pre-flight (before `systemctl start`)

| Check | Command | Expected |
|---|---|---|
| Node version | `node --version` | `v24.*` |
| Unit exists | `systemctl cat ordonuntius` | unit text printed, no error |
| Env file mode | `stat -c '%a %U:%G' /etc/ordonuntius/ordonuntius.env` | `640 ordonuntius:ordonuntius` |
| Env file has secret | `sudo grep -c SESSION_SECRET /etc/ordonuntius/ordonuntius.env` | `1` (value present) |
| Current release symlink | `readlink /opt/ordonuntius/current` | absolute path under `/opt/ordonuntius/releases/<stamp>` |
| Server.js present | `ls /opt/ordonuntius/current/server.js` | exists |
| Nginx config valid | `sudo nginx -t` | `syntax is ok` and `test is successful` |
| Cross-instance JMAP reachable | `curl -sSf https://mail.saltnlightllc.com/.well-known/jmap -o /dev/null -w '%{http_code}'` | `200` or `307` |
| Nginx not yet routing | `curl -sSf -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/` | `200` or `307` after manual `systemctl start ordonuntius` |

## Cutover sequence

```sh
# 1. Start OrdoNuntius (no public traffic yet — nginx hasn't reloaded).
sudo systemctl enable --now ordonuntius
sleep 3
sudo systemctl is-active --quiet ordonuntius || { journalctl -u ordonuntius -n 100; exit 1; }

# 2. Loopback smoke (bypasses nginx).
curl -sSf -o /dev/null -w 'loopback /=%{http_code}\n' http://127.0.0.1:3000/
curl -sSf -o /dev/null -w 'loopback api/config=%{http_code}\n' \
    http://127.0.0.1:3000/api/config

# 3. Reload nginx so the location / block now hits OrdoNuntius.
sudo nginx -t
sudo systemctl reload nginx

# 4. Public smoke (webmail UI only — JMAP /.well-known lives on
# mail.saltnlightllc.com, not on this host).
curl -sSf -o /dev/null -w 'public /=%{http_code}\n' https://webmail.saltnlightllc.com/
curl -sSf -o /dev/null -w 'cross-origin JMAP discovery=%{http_code}\n' \
    https://mail.saltnlightllc.com/.well-known/jmap
```

The webmail public code should be `200` (or `307` to a locale prefix —
acceptable). The cross-origin JMAP discovery probe lives on the OTHER
instance; if it fails, the issue is on mail.saltnlightllc.com, not here.

## Browser falsifier

Open Chrome on the operator workstation. Visit `https://webmail.saltnlightllc.com/`.
Walk through steps (1)–(5) of the falsifier above. The send-self test is the
load-bearing check — it exercises OrdoNuntius → OrdoEpistola JMAP submission
**and** OrdoEpistola SMTP outbound + inbound delivery.

## Rollback

```sh
# A. Revert OrdoNuntius to the previous release (releases retained: last 3).
PREV=$(ls -1dt /opt/ordonuntius/releases/*/ | sed -n '2p')
sudo ln -sfn "${PREV%/}" /opt/ordonuntius/current.new
sudo mv -Tf /opt/ordonuntius/current.new /opt/ordonuntius/current
sudo systemctl restart ordonuntius

# B. If rollback also fails or pre-OrdoNuntius restoration is required,
#    disable the OrdoNuntius nginx routing and serve a 503 from the
#    location / block while OrdoEpistola continues to handle JMAP.
sudo sed -i.bak \
    's|proxy_pass http://127.0.0.1:3000;|return 503;|' \
    /etc/nginx/conf.d/webmail.saltnlightllc.com.conf
sudo nginx -t && sudo systemctl reload nginx
```

## CloudWatch

Watch these for 15 minutes after cutover:

- `ordonuntius-email-lab-service-inactive` (added by `ordo-nuntius-iam.yaml`)
  — must stay OK.
- `ordonuntius-email-lab-degraded` (composite) — must stay OK.
- `saltnlight-prod-cpu-high` — should NOT fire from the OrdoNuntius
  release. Next.js cold-start can spike CPU briefly but well under 80%.
- `ordoepistola-email-lab-service-inactive` — separate instance; webmail
  can't relay mail without it. Should stay OK regardless of this release.

## After 24-hour soak

Once a release has run for 24h with no incidents, the previous release
directory is safe to prune. The install script retains last 3 automatically.
