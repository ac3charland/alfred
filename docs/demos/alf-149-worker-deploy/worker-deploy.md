---
branch: claude/epic-spec-posting-o9xqgq
---

# Merging the Worker deploys it (ALF-149)

*2026-07-28T17:29:36.457Z*

The ALF-146 habit-tracker epic spec merged on Jul 28 and never appeared in alfred, so every story prompt in that epic launched without its epic context. The spec was committed, the PR carried a correct `alfred` block, CI was green, and GitHub's webhook delivery came back **200**. Nothing anywhere reported a failure.

## What actually happened

The delivery's response body was `{"ignored":"no alfred frontmatter block"}` — the Worker had looked at a valid block and not recognised it. ALF-130 taught the Worker the `epic-refinement` phase and merged on **Jul 25**; deploying was a manual `wrangler deploy` that nobody ran. Cloudflare was still serving a build from before that commit, and its phase pattern has no branch that can match `epic-refinement`:

```bash
node --no-warnings docs/demos/alf-149-worker-deploy/root-cause.mjs 2>/dev/null
```

```output
deployed (pre-ALF-130) : const PHASE_RE = /phase:[ \t]*(refinement|implementation)/;
merged   (on main)     : const PHASE_RE = /phase:[ \t]*(epic-refinement|refinement|implementation)/;

PR 247 declares `phase: epic-refinement`. The old alternation has no branch that can
match it, so the phase reads undefined and the entire block is treated as absent:

  deployed parser → undefined
  merged   parser → {"tickets":["ALF-146"],"phase":"epic-refinement","specPath":"docs/specs/epics/ALF-146.html"}

the reply GitHub logged → 200 {"ignored":"no alfred frontmatter block"}
```

That 200 is the whole problem: a Worker three phases behind main answers *identically* to a healthy one that was handed a malformed PR. Nothing distinguished "your PR is wrong" from "production is stale", so the epic spec was dropped silently and the story prompts quietly lost their epic context.

## The fix: merging is deploying

`wrangler deploy` now runs on every push to `main`. Deliberately **not** `paths:`-filtered — a path filter is one more way for a change to reach main without reaching production, which is the exact failure being closed here. A no-op deploy costs about twenty seconds.

```bash
sed -n '/^on:/,/^jobs:/p' .github/workflows/deploy-worker.yml
```

```output
on:
  push:
    branches: [main]
  workflow_dispatch: {} # redeploy on demand (e.g. after rotating a secret)

# The job only reads the repo; Cloudflare auth comes from a secret.
permissions:
  contents: read

# Serialize deploys so two quick merges can't race and leave the OLDER commit live.
# cancel-in-progress: false — a half-cancelled `wrangler deploy` is worse than a queued one.
concurrency:
  group: deploy-worker
  cancel-in-progress: false

jobs:
```

## Telling a stale Worker from a current one

The old health route answered a bare `alfred workers ok` — true of any build ever deployed, which is why three days of staleness were invisible. It now names the commit it was built from, injected by the deploy (`--var WORKER_VERSION:$GITHUB_SHA`). Diffing it against `git rev-parse origin/main` answers "is production current?" in one curl:

```bash
node --no-warnings docs/demos/alf-149-worker-deploy/build-stamp.mjs 2>/dev/null
```

```output
deployed by CI   : alfred workers ok (build 10d3928)
deployed by hand : alfred workers ok (build unstamped)
```

## Recovering ALF-146

A dropped delivery is not replayed automatically — GitHub already got its 200. Once the deploy lands, replay PR 247's merge from **Settings → Webhooks → Recent Deliveries → Redeliver**. This is the real `handleWebhook`, on PR 247's real payload, with Supabase and the Contents API stubbed so every write is visible — the three calls that redelivery will now make:

```bash
node --no-warnings docs/demos/alf-149-worker-deploy/writes-once-deployed.mjs 2>/dev/null
```

```output
── pull_request.opened → 200 {"ok":true,"tickets":["ALF-146"]}
     https://proj.supabase.co/rest/v1/epics?ref=eq.ALF-146
       {"refinement_pr_url":"https://github.com/ac3charland/alfred/pull/247"}

── pull_request.closed (merged) → 200 {"ok":true,"tickets":["ALF-146"]}
     https://proj.supabase.co/rest/v1/epics?ref=eq.ALF-146
       {"spec_path":"docs/specs/epics/ALF-146.html"}
     https://api.github.com/repos/ac3charland/alfred/contents/docs/specs/epics/ALF-146.html?ref=832fe360e52a9075bf0aa13aa2abdb0568209846
     https://proj.supabase.co/rest/v1/epics?ref=eq.ALF-146
       {"spec_markdown":"<html>the epic spec</html>","spec_sha":"b1a5f00d"}
```

`epics.spec_path` lands, the spec snapshot follows, and `v_code_stories.epic_spec_path` lights up — which is what puts the epic-context paragraph (naming epic **ALF-146** and its spec) back into every story prompt in the epic. Redelivery is idempotent: the transition PATCHes columns to fixed values rather than incrementing anything.

## One-time setup

The workflow needs a `CLOUDFLARE_API_TOKEN` repo secret (Cloudflare → My Profile → API Tokens → *Edit Cloudflare Workers*). Until it exists the workflow fails on every merge to `main` — which is the intended noise. A Worker that isn't deploying should be loud, not silent.
