---
branch: claude/alm-231-sdlc-checkins-f1esen
---

# Forbid a scheduled check-in once a PR is open (ALF-231)

*2026-09-18T11:40:44.931Z*

ALF-231: CLAUDE.md now forbids *proactively* scheduling a wakeup/timer/cron job to poll an already-open PR, its CI, or its deploy — left running (overnight, say) that's tokens spent on polls that almost always find nothing new. It does NOT forbid responding to a real CI failure or comment that arrives via an event subscription (`subscribe_pr_activity`) — that stays required. The line is proactive vs. reactive, not "stop watching the PR." Each SDLC-cycle skill (bug, spike, refinement, epic-refinement, implement-spec, implement-epic) cross-references that rule. This is the one place the rule is deliberately duplicated instead of only linked: the seven Claude Code launch prompts the code module's buttons prefill now carry the guardrail verbatim, so it reaches the agent even after it has stopped reading further files.

## The seven launch prompts, built by the real link builders

```bash
node --no-warnings docs/demos/no-scheduled-check-ins/print-guardrail.mjs
```

```output
buildRefinementUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
buildSpikeUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
buildBugUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
buildImplementationUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
buildBypassUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
buildEpicRefinementUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
buildEpicImplementationUrl:
  Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer — CLAUDE.md forbids the proactive poll, not reacting to real activity. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)

=== all seven prompts carry the identical guardrail line ===
```

## The source of truth: CLAUDE.md

```bash
sed -n "/### No scheduled check-ins/,/^---/p" CLAUDE.md | sed "/^---/d"
```

```output
### No scheduled check-ins (once the PR is open)

A session's job is to ship the PR, not to keep initiating checks on it afterward. **Once a
PR is open, never proactively schedule a wakeup, timer, or recurring job** (e.g.
`ScheduleWakeup`, `send_later`, a cron trigger) to poll it, its CI run, or its deploy for
status — left running (overnight, say) that's tokens spent on repeated polls that almost
always find nothing new. This is **not** license to ignore the PR: when a CI failure or a
comment actually arrives, respond to it. Get that forward visibility from an event
subscription (e.g. `subscribe_pr_activity`) instead of a timer — it's push-driven, so
activity finds you rather than you asking on a schedule. The line is proactive vs.
reactive: initiating a check yourself is forbidden; answering one that reaches you is not
just allowed, it's expected.

This doesn't restrict pacing your **own** still-in-progress work: scheduling a wakeup to
wait out a long-running task — a slow `check:slow` run, a build, a deploy you're actively
driving before the PR exists — is a normal, allowed use of the same tools. The line is
whether the PR is already open, not whether the tool was used.

This holds everywhere in the SDLC cycle: refinement, spike, bug-fix, epic-refinement, and
implementation sessions alike stop proactively polling once "PR opened," never before —
though all of them keep responding to whatever activity an event subscription delivers.
```

## Each SDLC skill cross-references it (the bug skill, as an example)

```bash
grep -A2 "Don.t proactively schedule a check-in" .claude/skills/bug/SKILL.md
```

```output
- **Don't proactively schedule a check-in on the PR.** CLAUDE.md's "No scheduled
  check-ins" rule applies here — once the PR is open, respond to CI failures or comments
  that reach you, but don't poll for them on a timer.
```
