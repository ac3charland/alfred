---
branch: claude/alm-231-sdlc-checkins-f1esen
---

# Forbid a scheduled check-in once a PR is open (ALF-231)

*2026-09-18T11:40:44.931Z*

ALF-231: CLAUDE.md now forbids scheduling a wakeup/timer/cron job to poll an already-open PR, its CI, or its deploy — a session's job ends once the PR is open, and watching what happens next is either event-driven (subscribe to PR activity) or the human's call. Each SDLC-cycle skill (bug, spike, refinement, epic-refinement, implement-spec, implement-epic) cross-references that rule. This is the one place the rule is deliberately duplicated instead of only linked: the seven Claude Code launch prompts the code module's buttons prefill now carry the guardrail verbatim, so it reaches the agent even after it has stopped reading further files.

## The seven launch prompts, built by the real link builders

```bash
node --no-warnings docs/demos/no-scheduled-check-ins/print-guardrail.mjs
```

```output
buildRefinementUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)
buildSpikeUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)
buildBugUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)
buildImplementationUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)
buildBypassUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)
buildEpicRefinementUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)
buildEpicImplementationUrl:
  Once this PR is open, don't schedule a check-in on it — no wakeup, timer, or recurring job to poll it, its CI, or its deploy for status. CLAUDE.md forbids that; what happens after the PR is open is not this session's job. (Scheduling one to pace your own work before that — waiting out a slow check, say — is unaffected and fine.)

=== all seven prompts carry the identical guardrail line ===
```

## The source of truth: CLAUDE.md

```bash
sed -n "/### No scheduled check-ins/,/^---/p" CLAUDE.md | sed "/^---/d"
```

```output
### No scheduled check-ins (once the PR is open)

A session's job ends when its deliverable — a PR — is pushed and described; it does not
keep running to watch what happens next. **Once a PR is open, never schedule a wakeup,
timer, or recurring job** (e.g. `ScheduleWakeup`, `send_later`, a cron trigger) to poll
that PR, its CI run, or its deploy for status. A scheduled check-in there burns tokens on
a poll that almost always finds nothing new. If you genuinely need forward visibility into
PR activity, subscribe to the event stream (e.g. `subscribe_pr_activity`) so activity
finds you instead of you polling for it — that is push-driven, not a standing timer, and
stays allowed. Otherwise, what happens after the PR is open is the human's call, not a
task this session keeps for itself.

This is about the PR's lifecycle, not your own pace: scheduling a wakeup to wait out a
long-running task in your **own** still-in-progress work — a slow `check:slow` run, a
build, a deploy you're actively driving before the PR exists — is a normal, allowed use of
the same tools. The line is whether the PR is already open, not whether the tool was used.

This holds everywhere in the SDLC cycle: refinement, spike, bug-fix, epic-refinement, and
implementation sessions alike stop watching once "PR opened," never before.
```

## Each SDLC skill cross-references it (the bug skill, as an example)

```bash
grep -A1 "Don.t schedule a check-in" .claude/skills/bug/SKILL.md
```

```output
- **Don't schedule a check-in on the PR.** CLAUDE.md's "No scheduled check-ins" rule
  applies here — this session's job ends once the PR is open.
```
