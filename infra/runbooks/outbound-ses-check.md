# Runbook — outbound SES check

End-to-end verification that OrdoEpistola can send mail through AWS SES
for `saltnlightllc.com`. Three layers:

1. **AWS side** — SES identity verified, DKIM tokens active, sandbox
   status known, SMTP credentials valid.
2. **DNS side** — SPF, DMARC, DKIM CNAMEs published and correct.
3. **Application side** — OrdoEpistola JMAP submission → SES → delivery.

The local xtask runner handles (2). (1) and (3) need either AWS CLI
access or shell access to the email-lab box.

## 1. AWS side — SES identity and SMTP creds

From a workstation with AWS CLI configured for the Salt & Light account
(`338071012635`, `us-east-2`):

```sh
# Domain identity status — must show "Success"
aws ses get-identity-verification-attributes \
    --region us-east-2 \
    --identities saltnlightllc.com \
    --query 'VerificationAttributes."saltnlightllc.com".VerificationStatus'

# DKIM token status — all 3 must show "Success"
aws ses get-identity-dkim-attributes \
    --region us-east-2 \
    --identities saltnlightllc.com \
    --query 'DkimAttributes."saltnlightllc.com"'

# Sandbox status — production access required to send to unverified addresses
aws ses get-account-sending-enabled --region us-east-2
aws sesv2 get-account --region us-east-2 \
    --query 'ProductionAccessEnabled'

# SMTP credentials probe (don't print, just verify keys exist in SSM)
aws ssm get-parameter --region us-east-2 --with-decryption \
    --name /saltnlight/email/email-lab/ses/smtp-username \
    --query 'Parameter.Value' --output text | head -c 8 ; echo " ..."
aws ssm get-parameter --region us-east-2 --with-decryption \
    --name /saltnlight/email/email-lab/ses/smtp-password \
    --query 'Parameter.Value' --output text | head -c 8 ; echo " ..."
```

Pass criteria:

- `VerificationStatus` is `Success`
- All 3 DKIM tokens show `DkimVerificationStatus: Success` and the 3
  tokens are listed in `DkimTokens`
- `ProductionAccessEnabled` is `true` (or sandbox is acceptable for the
  current launch posture; document in change ticket)
- Both SSM SMTP creds parameters exist

If `ProductionAccessEnabled` is `false` and we need to send to
unverified addresses, request production access in the SES console
(typical turnaround 24h).

## 2. DNS side — the xtask check

From the OrdoNuntius repo root on the operator workstation:

```sh
# Get the 3 DKIM tokens from step 1 first:
TOKENS=$(aws ses get-identity-dkim-attributes --region us-east-2 \
    --identities saltnlightllc.com \
    --query 'DkimAttributes."saltnlightllc.com".DkimTokens' --output text \
    | tr '\t' ',')

SES_DKIM_TOKENS="$TOKENS" npm run xtask -- check-dns
```

Expected output:

```
[xtask] check-dns saltnlightllc.com (host: mail.saltnlightllc.com)
  ok   MX: mail.saltnlightllc.com
  ok   SPF: v=spf1 include:amazonses.com -all
  ok   DMARC: v=DMARC1; p=quarantine; rua=...
  ok   DKIM: <t1>: ok; <t2>: ok; <t3>: ok
  ok   A: 16.58.225.15

  passed=5 failed=0 skipped=0
```

Failures mean DNS isn't where it needs to be — the apex DNS provider
hasn't propagated the records yet, or the records were misentered.

If `DMARC` reports `p=none`, that's not a hard failure for sending, but
the SES inbox-placement story is weaker — request `p=quarantine` from
whoever owns the DNS provider.

## 3. Application side — JMAP submission roundtrip

This piggybacks on the restart-canary's browser test
(`infra/runbooks/restart-canary-webmail.md`). The composer's "send"
button issues a JMAP `EmailSubmission/set` call to OrdoEpistola, which
relays through SES outbound.

Headless variant if you want to test without a browser:

```sh
# On the email-lab host, with an admin password:
ssh ordo-epistola
sudo bash <<'EOF'
ADMIN_USER=$(awk -F'=' '/RECOVERY_ADMIN/ { print $2 }' /etc/ordoepistola/ordoepistola.env | cut -d: -f1)
ADMIN_PASS=$(awk -F'=' '/RECOVERY_ADMIN/ { print $2 }' /etc/ordoepistola/ordoepistola.env | cut -d: -f2-)

# Use the OrdoEpistola repo's outbound test script (lives at
# /opt/ordoepistola/.tmp/outbound_test.py if pre-positioned, else
# copy from OrdoEpistola/.tmp/outbound_test.py)
python3 /opt/ordoepistola/.tmp/outbound_test.py \
    --account-id <test-account-id> \
    --to external-deliverability-test@example.com
EOF
```

Pass criteria:

- The `EmailSubmission/set` JMAP call returns `created` (not `notCreated`).
- The OrdoEpistola journal log shows `mail.delivery.smtp` for the
  message ID with no `mail.delivery.failure`.
- A copy of the message appears in Sent on the JMAP side.
- The remote inbox receives the message (check headers for `dkim=pass`
  and `spf=pass`).

## Diagnostics if something fails

| Symptom | First place to look |
|---|---|
| SPF fails check-dns | DNS provider config (external; see `Saltnlight/ops/aws.md:248`) |
| DKIM fails check-dns | SES Easy DKIM CNAMEs not published; copy from SES console |
| DMARC missing | DNS provider config |
| JMAP submission returns `notCreated` reason=`forbidden` | OrdoEpistola can't reach SES — check `ORDO_EPISTOLA_SES_SMTP_USERNAME` / `_PASSWORD` env vars |
| JMAP submission returns `notCreated` reason=`tooManyRecipients` | SES sandbox limits hit; request production access |
| Message sent but rejected by remote | DKIM signature mismatch — re-check that DKIM CNAMEs resolve to `<token>.dkim.amazonses.com` (no extra trailing dot, no other rewrites) |
| Message marked spam at remote | Re-run check-dns; verify DMARC `p=quarantine`; ensure From header domain matches the SES verified identity |

## Cadence

Run this check:

- Before each production cutover.
- After any DNS provider change.
- After any SES SMTP credential rotation (`Saltnlight/ops/runbooks/rotate-secrets.md`).
- Quarterly as a routine.

The xtask portion (DNS) can be added to the per-deploy canary if desired
— wire it into the deploy step. Skipped for now to keep the pre-deploy
gate fast.
