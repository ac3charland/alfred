---
branch: fix/comms-ingest-shape-and-deploy-retry
---

# Deploy Worker survives a transient Cloudflare blip

*2026-09-11T17:33:17.893Z*

The 2026-09-11 deploy of `00bac05b` (the comms-module merge) went red with a message that
blamed the network:

> ▲ [WARNING] A fetch request failed, likely due to a connectivity issue.
> ✘ [ERROR] fetch failed

It looked like the comms module had broken the deploy — it was the very next push, and the run
before it was green. It hadn't. Two things in that same log say so:

- **The clock.** Wrangler printed its banner at `17:20:21.73` and the error at `17:20:22.07` —
  **330 ms**. A real deploy of this Worker spends ~8 s bundling before it can print
  `Total Upload:`; the successful re-run did exactly that. The failing run died roughly 24×
  faster than it takes to even *reach* the code, so no line of the comms module had been read
  when it gave up.
- **The network was up.** The same output ends with *"there is a newer version of Wrangler
  available (4.131.1)"* — a fact wrangler can only learn by successfully fetching the npm
  registry in that same process.

So the failed fetch was the Cloudflare API call that resolves the account, before bundling, and
the "check your network connection" advice is a red herring. Re-running the **identical commit**
with no code change deployed it fine, which settles it.

The real problem is what the failure did to the pipeline. This workflow exists precisely so a
commit on `main` cannot sit undeployed (its header records ALF-130 doing that for three days) —
and a transport blip reopened that hole: red run, stale production, misleading error. So the
deploy step now retries.

The harness below pulls the deploy step **verbatim out of the committed workflow** (never a retyped copy) and runs it under `bash -e` — the same shell a GitHub Actions `run:` block gets — against a stubbed `npx`, so the retry behaviour is observable without touching Cloudflare.

```bash
bash docs/demos/deploy-worker-retry/retry-harness.sh
```

```output
=== the deploy step, as committed ===
attempts=3
for attempt in $(seq 1 $attempts); do
  if npx wrangler deploy --var WORKER_VERSION:"$GITHUB_SHA"; then
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::wrangler deploy attempt $attempt/$attempts failed - retrying in $((attempt * 15))s"
    sleep $((attempt * 15))
  fi
done
echo "::error::wrangler deploy failed after $attempts attempts - main is NOT deployed"
exit 1

=== behaviour ===

--- deploy succeeds first try
    exit code ............ 0
    deploys attempted .... 1
    retry warnings ....... 0

--- transient blip, then succeeds
    exit code ............ 0
    deploys attempted .... 3
    retry warnings ....... 2

--- genuinely broken deploy
    exit code ............ 1
    deploys attempted .... 3
    retry warnings ....... 2
    ::error::wrangler deploy failed after 3 attempts - main is NOT deployed
```

The three cases that matter:

- **Succeeds first try** — one attempt, no warnings, no added latency. The happy path pays nothing.
- **Transient blip** — the exact failure above: two failures, then a success, and the step ends
  green with `main` actually deployed instead of red with production stale.
- **Genuinely broken** — auth, config or an oversized script fails all three times, so the run
  still ends red. The retry buys resilience without hiding real faults, and the final message
  says plainly that `main` is not deployed.

`set -e` doesn't abort on the failing attempts (the invocation sits on the left of an `if`), and
there's no wasted sleep after the last one — two warnings for three attempts.

Production is back in step with `main`. The re-run of the identical commit deployed it, the live
build stamp matches `origin/main`, and both cron schedules registered:

    $ curl -s https://alfred-workers.alfred-six-gamma.workers.dev/
    alfred workers ok (build 00bac05b21a2188c5c1a51978b3bdba126277b3e; ...; comms ingest configured)

    $ git rev-parse origin/main
    00bac05b21a2188c5c1a51978b3bdba126277b3e

Quoted rather than executed: the stamp moves with every merge, so running it would make `verify`
drift for no gain.
