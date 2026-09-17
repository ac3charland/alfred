---
branch: claude/affectionate-bardeen-9rqczt
---

# Re-authorizing Gmail after a refresh token dies

*2026-09-17T19:15:02.575Z*

Both Gmail accounts went red at once with `refresh token rejected — re-authorize`. The cause was the one ALF-7's decision D23 named in advance: the OAuth client's publishing status was still *Testing*, and a Testing client issues refresh tokens that expire after seven days with no warning. The client was created Sep 9; the tokens died on schedule.

D23 was carried out — the client is now *In production*. But that only changes the TTL of **newly issued** tokens, and the health surface's instruction when a token dies is a single word: `re-authorize`. Until now that word named no procedure. `gmail-probe` could tell you whether a refresh token still worked; nothing in the repo could give you one. This adds the missing half.

## The guard

Both captures below run the shipped script from a **copy in a temp directory**, never from `workers/`. That is deliberate: the real `workers/.dev.vars` holds live OAuth credentials, and a demo that reads it would print them. The copy reads an empty or fake `.dev.vars` of its own, so this doc can be re-run on any machine without touching a secret.

With no client credentials to work from, the script says so and stops rather than opening a browser at nothing:

```bash
tmp=$(mktemp -d) && mkdir -p "$tmp/scripts" && cp workers/scripts/gmail-authorize.ts "$tmp/scripts/" && node "$tmp/scripts/gmail-authorize.ts"
```

```output
workers/.dev.vars has no GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET — nothing to authorize.
Add the Desktop OAuth client there, then run this again.
```

## The consent URL, and the flag the whole thing turns on

Given a client, the script stands up a loopback listener on an ephemeral port and builds the consent URL against it. A Desktop OAuth client registers no redirect URIs, so loopback is the flow it is for — nothing to add in the console, nothing to remember to remove afterwards.

The port is normalized to `<port>` below so the capture reproduces; everything else is verbatim:

```bash
tmp=$(mktemp -d) && mkdir -p "$tmp/scripts" && cp workers/scripts/gmail-authorize.ts "$tmp/scripts/" && printf 'GMAIL_OAUTH_CLIENT_ID=137173925735-demo.apps.googleusercontent.com\nGMAIL_OAUTH_CLIENT_SECRET=GOCSPX-demo-secret\n' > "$tmp/.dev.vars" && timeout 5 node "$tmp/scripts/gmail-authorize.ts" > "$tmp/out.txt" 2>&1; sed -E 's/127\.0\.0\.1%3A[0-9]+/127.0.0.1%3A<port>/' "$tmp/out.txt"
```

```output

Open this in the browser, signed in as the account you are authorizing:

https://accounts.google.com/o/oauth2/v2/auth?client_id=137173925735-demo.apps.googleusercontent.com&redirect_uri=http%3A%2F%2F127.0.0.1%3A<port>&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&access_type=offline&prompt=consent

gmail.readonly is a restricted scope, so an unverified app warning is expected:
  "Google hasn't verified this app" -> Advanced -> Go to Alfred Comms (unsafe)

Waiting for the redirect...
```

`access_type=offline` asks for a refresh token at all. `prompt=consent` asks for one **even though this account has consented to this client before** — and that is the flag the whole script exists to guarantee. Without it Google returns an access token, omits `refresh_token` entirely, and the failure looks like success right up until the secret is deployed and the dot goes red again. Re-authorization is by definition always the *second* consent, so the flag that only matters the second time is the flag that always matters here. Hard-coding it is the difference between a procedure and a trap.

The scope is `gmail.readonly` and nothing else, matching what the poller actually uses — profile, message lists, messages. It never writes.

## Using it

Once per account, then deploy. Written as prose rather than a fenced block on purpose: `verify` re-runs every fenced command in this file, and a `wrangler secret put` is not something a demo should reproduce.

- `npm run gmail:authorize -w workers` — mint a refresh token, paste it into `workers/.dev.vars`
- `npm run gmail:probe -w workers` — confirms both mailboxes open before anything is deployed
- `npx wrangler secret put GMAIL_PERSONAL_REFRESH_TOKEN`, from `workers/`
- `npx wrangler secret put GMAIL_REALPLAY_REFRESH_TOKEN`, from `workers/`

Secrets take effect on the next invocation with no redeploy, and the poll rides `*/3 * * * *`, so the dots clear within about three minutes. Expect a large catch-up afterwards: the re-seed anchors on `last_seen_at` rather than `now − 7d`, so the whole outage is ingested rather than a truncated slice of it.
