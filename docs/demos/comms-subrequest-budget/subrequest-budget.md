---
branch: fix/comms-ingest-shape-and-deploy-retry
---

# Comms work fits the Free plan's subrequest budget

*2026-09-11T18:09:47.506Z*

`wrangler tail` showed the cron failing on every single tick:

    comms: comms sweep: Too many subrequests by single Worker invocation

The Workers runtime allows **50 outbound fetches per invocation** on the Free plan. Three separate
places in the comms module scaled with how much mail was waiting, and none of them was bounded
against that number:

- the **Gmail poll** listed up to `MAX_MESSAGE_IDS = 500` ids per account and read each one;
- the **judge pass** classified 10 messages, each costing a model call plus its verdict writes;
- the **daemon ingest** spent one subrequest per *outbound* message in a batch, draining its thread
  — so the 214-message iMessage batch alone was ~218.

Worse, the poll and the judge pass shared a single `*/2 * * * *` invocation, so each was the reason
the other ran out.

The fix is to bound the work per invocation and let a backlog drain across ticks. Nothing here is
latency-sensitive — the whole premise is capture-now-refine-later — and a backlog is transient: once
a source is caught up, a tick's poll returns a handful of messages and none of these caps is reached.

Three changes: the poll gets **its own cron** on the odd minutes so it stops competing with the
judge pass (mail polled at :01 is judged at :02); the two per-tick caps come down; and the daemon
sends **bounded chunks** rather than one enormous POST, dropping only the chunk the Worker actually
accepted so the untried remainder is never discarded.

The script below recomputes the worst case for each invocation **from the constants actually committed in the source** — it reads `MAX_MESSAGE_IDS`, `COMMS_SWEEP_LIMIT` and `MAX_INGEST_BATCH_MESSAGES` out of the files rather than restating them, so the demo cannot drift away from what ships.

```bash
node docs/demos/comms-subrequest-budget/budget.mjs
```

```output
Free-plan ceiling: 50 subrequests per invocation

crons = ["*/2 * * * *", "1-59/2 * * * *", "17 9 * * *"]

OK   gmail poll     (1-59/2 * * * *)  14 fixed + 2 x  15 =  44
OK   judge + inbox  (*/2 * * * *)  11 fixed + 5 x   6 =  41
OK   daemon ingest  (POST /comms/ingest)   4 fixed + 1 x  25 =  29

Before this change, in ONE shared invocation:
OVER gmail poll + judge together    1014 + 61 = 1075
OVER daemon ingest of 214 messages  4 + 1 x 214 = 218
```

Every path now has real headroom under the 50-subrequest ceiling — 44, 41 and 29 against a limit of
50 — where the two cron units previously needed **1075** between them in one invocation and the
daemon's opening batch needed **218**.

The three registered schedules are visible in the `crons` line: the judge pass on the even minutes,
the Gmail poll on the odd ones, and the nightly retention sweep. They are separate expressions
because the handler dispatches on the cron *string* — two identical `*/2 * * * *` entries would be
indistinguishable to it.

Worth keeping in view when these numbers are next touched: going over the budget is not a graceful
degradation. The invocation throws part-way, so a poll stores nothing and leaves its cursor
unmoved, and a half-finished sweep has already paid for model calls whose verdicts it never managed
to write. That is why each constant's doc comment carries this arithmetic next to it.
