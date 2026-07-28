# Deploying the Software Factory webhook Worker (M7, Phase C)

> The Worker code (HMAC verify, frontmatter parse, transition table, spec snapshot) ships in
> `workers/src/` with full unit coverage. This doc is the **credentialed Phase-C closeout**:
> get a Cloudflare account, set the four secrets, deploy, and wire each project repo's
> webhook to it. None of this runs in a CI/web sandbox — do it locally with the secrets to hand.
>
> Pairs with [`repo-setup/README.md`](repo-setup/README.md), which covers the **per-repo** side
> (the enforcing Action, the refinement skill, the webhook config).

## What you'll end up with

```
GitHub repo (ac3charland/alfred, …)                Cloudflare
  ├─ .github/workflows/alfred-frontmatter.yml      ┌───────────────────────────┐
  ├─ .claude/skills/refinement/SKILL.md            │ alfred-workers Worker     │
  └─ Settings → Webhooks ──── pull_request ───────▶│  POST /github/webhook     │
                              (HMAC secret)         │   verify → parse → patch  │
                                                    └─────────┬─────────────────┘
                                          service-role write  │   │  Contents:read
                                            ┌─────────────────▼┐  └─▶ GitHub Contents API
                                            │ Supabase code_items│     (spec snapshot)
                                            └────────────────────┘
```

## 1. Create the Cloudflare account & install Wrangler

1. Sign up at <https://dash.cloudflare.com/sign-up> (the **free** Workers plan is enough). Verify
   your email.
2. From the repo root, authenticate Wrangler against that account — this is an **interactive
   browser login**, so run it yourself in the session prompt:

   ```
   ! npx wrangler login
   ```

   It opens a browser, you click **Allow**, and the OAuth token is cached on your machine
   (`~/.wrangler`). No API token to copy/paste — `wrangler login` is the recommended path.

   *(Alternative, for CI later: create a scoped **API token** in the dashboard → My Profile → API
   Tokens → "Edit Cloudflare Workers" template, and export it as `CLOUDFLARE_API_TOKEN`. You do
   **not** need this for a local deploy — `wrangler login` is simpler.)*

3. Confirm you're authenticated:

   ```
   npx wrangler whoami
   ```

## 2. Gather the four secret values

The Worker's typed `Env` (`workers/src/index.ts`) needs exactly these. Get each value ready before
you set them:

| Secret | Where it comes from |
|---|---|
| `GITHUB_WEBHOOK_SECRET` | **You invent it.** Any high-entropy string — generate one with `openssl rand -hex 32`. You'll paste the *same* value into each repo's webhook config (step 4). |
| `GITHUB_TOKEN` | A **fine-grained PAT**: GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Scope it to the project repos with **Repository permissions → Contents: Read-only**. Used to snapshot the spec on refinement-merge. |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → Data API → **Project URL** (`https://<ref>.supabase.co`). Same value as `frontend/.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API Keys → **`service_role`** secret. This bypasses RLS — treat it like a password; it only ever lives as a Worker secret, never in the frontend. |

## 3. Set the secrets & deploy

Run each from the `workers/` directory (or add `-c workers/wrangler.toml`). Each command prompts
for the value and stores it encrypted on the deployed Worker:

```
cd workers
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

`wrangler deploy` prints the live URL, e.g. `https://alfred-workers.<your-subdomain>.workers.dev`.
Smoke-test the health route:

```
curl https://alfred-workers.<your-subdomain>.workers.dev/
# → alfred workers ok (build 8cbc1d5…)   ← the commit this Worker was built from
# → alfred workers ok (build unstamped)  ← deployed by hand; nothing records which commit it is
```

That build stamp is the answer to *"is production actually current?"* — diff it against
`git rev-parse origin/main`. A CI deploy stamps the merge commit; a hand-run `wrangler deploy`
passes no `--var`, so it reports `unstamped`.

The webhook ingress is `POST /github/webhook` on that same host — that's the **Payload URL** you'll
give GitHub next.

> **Local iteration (optional).** `npx wrangler dev` serves at `http://localhost:8787`. It reads
> secrets from a gitignored `workers/.dev.vars` file (dotenv format, same four keys) instead of the
> deployed secrets. Never commit `.dev.vars`.

## 4. Point each project repo's webhook at it

For every repo you run through the factory, follow the per-repo checklist in
[`repo-setup/README.md`](repo-setup/README.md). The webhook step is where the two halves meet:

- **Payload URL:** `https://alfred-workers.<your-subdomain>.workers.dev/github/webhook`
- **Content type:** `application/json`
- **Secret:** the **same** `GITHUB_WEBHOOK_SECRET` you set in step 3.
- **Events:** *Let me select individual events* → **Pull requests** only.

## 5. End-to-end smoke test

Open a real refinement PR carrying the `alfred` block (the refinement Claude Code session does this
for you), then:

1. **Merge it.** Within seconds the story should jump `in_refinement → ready_for_dev` on the board,
   and the detail modal should render the snapshotted spec.
2. If nothing happens, check GitHub → repo → Settings → Webhooks → **Recent Deliveries** and read
   the **response body**:

   | Response | What it means |
   |---|---|
   | `401 {"error":"invalid signature"}` | The webhook secret mismatches step 3. |
   | `200 {"ignored":"no alfred frontmatter block"}` | The Worker couldn't parse the block. Either the PR body really is malformed (compare it to `repo-setup/README.md`) — **or the deployed Worker is older than the phase the PR uses**, which looks identical from here. Check the build stamp on `GET /` before suspecting the PR. |
   | `200 {"ok":true,"tickets":[]}` | Parsed fine, but the ref matched no row: a typo'd ref, or a story ref sent at `epics` (or vice versa). |
   | `200 {"ok":true,"tickets":["ALF-42"],…}` | It worked. If the board still looks wrong, the problem is downstream (schema cache, realtime). |
3. Tail the Worker logs live with `npx wrangler tail` while you redeliver from the Recent Deliveries
   panel.

## Updating the Worker later

**Nothing to do — merging to `main` deploys.** `.github/workflows/deploy-worker.yml` runs
`wrangler deploy` on every push to `main` (and on demand via *Actions → Deploy Worker → Run
workflow*). Secrets persist across deploys — you only re-`secret put` a value when it changes
(e.g. you rotate the PAT). After any `wrangler.toml` binding change, run `npx wrangler types` to
refresh `worker-configuration.d.ts` (note: the secrets are typed by hand in `src/index.ts`, since
`wrangler types` only generates *bindings*, not secrets).

### One-time setup for the automatic deploy

The workflow authenticates with a repo secret. Create the token in the Cloudflare dashboard →
My Profile → API Tokens → **"Edit Cloudflare Workers"** template, then add it under GitHub → repo
→ Settings → Secrets and variables → Actions:

| Secret | Required? | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Yes** | The "Edit Cloudflare Workers" API token. |
| `CLOUDFLARE_ACCOUNT_ID` | Only if the token can see more than one account | Dashboard → Workers & Pages → Account ID. Leave it unset otherwise. |

Until that secret exists the workflow runs and fails on every merge to `main` — which is the
intended noise. A Worker that isn't deploying should be loud, not silent.

> **Why this exists (ALF-149).** ALF-130 added the `epic-refinement` phase to the Worker, merged
> on Jul 25, and was never hand-deployed. Production kept running a build that had never heard of
> the phase, so every epic-refinement PR got `200 {"ignored":"no alfred frontmatter block"}` and was
> dropped on the floor — a green delivery, an epic spec that silently never attached. Deploying
> from CI is what stops "merged" and "live" from drifting apart.

## Recovering a webhook the Worker dropped

A delivery that hit a stale (or broken) Worker is **not** replayed automatically — GitHub got its
`200`. Once the Worker is fixed and deployed, replay it by hand:

1. GitHub → repo → Settings → Webhooks → the Worker's hook → **Recent Deliveries**.
2. Find the delivery to re-run — for a merge it's the `pull_request` delivery whose payload has
   `"action": "closed"` with `"merged": true`.
3. **Redeliver.** The Worker re-runs the transition against the same payload, so the ticket
   advances (and a refinement spec snapshots) exactly as it should have at merge time.

Redelivery is idempotent — the transition PATCHes columns to fixed values rather than
incrementing anything — so re-running one you're unsure about is safe.
