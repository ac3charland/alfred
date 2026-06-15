# Deploying the Software Factory webhook Worker (M7, Phase C)

> The Worker code (HMAC verify, frontmatter parse, transition table, spec snapshot) ships in
> `workers/src/` with full unit coverage. This doc is the **credentialed closeout** (spec §16.1
> Phase C): get a Cloudflare account, set the four secrets, deploy, and wire each project repo's
> webhook to it. None of this runs in a CI/web sandbox — do it locally with the secrets to hand.
>
> Pairs with [`repo-setup/README.md`](repo-setup/README.md), which covers the **per-repo** side
> (the enforcing Action, the refinement guide, the webhook config).

## What you'll end up with

```
GitHub repo (ac3charland/alfred, …)                Cloudflare
  ├─ .github/workflows/alfred-frontmatter.yml      ┌───────────────────────────┐
  ├─ .alfred/refinement.md                         │ alfred-workers Worker     │
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
| `GITHUB_TOKEN` | A **fine-grained PAT**: GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Scope it to the project repos with **Repository permissions → Contents: Read-only**. Used to snapshot the spec on refinement-merge (§13.3). |
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
# → alfred workers ok
```

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
2. If nothing happens, check GitHub → repo → Settings → Webhooks → **Recent Deliveries**: a `401`
   means the secret mismatches step 3; a `200` with no board change means the `alfred` block didn't
   parse (compare it to §12) or the ref isn't a story in `code_items`.
3. Tail the Worker logs live with `npx wrangler tail` while you redeliver from the Recent Deliveries
   panel.

## Updating the Worker later

Re-run `npx wrangler deploy` from `workers/`. Secrets persist across deploys — you only re-`secret
put` a value when it changes (e.g. you rotate the PAT). After any `wrangler.toml` binding change,
run `npx wrangler types` to refresh `worker-configuration.d.ts` (note: the four secrets are typed by
hand in `src/index.ts`, since `wrangler types` only generates *bindings*, not secrets).
