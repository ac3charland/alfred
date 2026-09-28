---
branch: claude/alf-282-opus-adversarial-review-c1ld62
---

# Opus adversarial review on every code-lane PR (ALF-282)

*2026-09-28T13:30:57.361Z*

ALF-282: once an implementation, skip-refinement, or bug-fix session has opened its PR, it now spawns a review subagent with its model set to Opus (whatever model the implementer is), keeps it report-only, waits for its report in the foreground, fixes the in-scope findings it verifies as legitimate, raises out-of-scope ones with the human, and records every finding's disposition in an "Adversarial review" section of the PR description. One round by default; the ticket notes, which the prompt appends after this step, can ask for more or none. The step lives in the three launch prompts themselves, because the skip-refinement lane loads no skill and a session has stopped reading files by the time its PR is open. The how (briefing the reviewer cold, triage, the audit trail) lives in a new adversarial-review skill that each prompt points at.

## Every launch prompt, built by the real link builders

The three code lanes carry the identical step (bar its step number). The two document lanes (refinement, spike) and the two epic lanes carry none. The full skip-refinement prompt follows, showing where the step sits: after the pre-PR self-check, before the check-in guardrail and the ticket notes that can override it.

```bash
node --no-warnings docs/demos/alf-282-adversarial-review/print-review-step.mjs
```

````output
buildImplementationUrl:
  Once the PR is open, run ONE round of adversarial review: spawn a subagent with its model set to Opus (e.g. the Agent tool's `model: "opus"` — left unset, it typically inherits yours), whatever model you are yourself, to review the PR antagonistically — briefed without your reasoning, and report-only (no edits, commits, or pushes). Run it in the foreground and wait for its report; that wait is your own work, not a check-in. Fix the in-scope findings you verify as legitimate and push; raise real but out-of-scope ones with me rather than widening the diff. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, declined and why, or raised with me), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
buildBypassUrl:
  6. Once the PR is open, run ONE round of adversarial review: spawn a subagent with its model set to Opus (e.g. the Agent tool's `model: "opus"` — left unset, it typically inherits yours), whatever model you are yourself, to review the PR antagonistically — briefed without your reasoning, and report-only (no edits, commits, or pushes). Run it in the foreground and wait for its report; that wait is your own work, not a check-in. Fix the in-scope findings you verify as legitimate and push; raise real but out-of-scope ones with me rather than widening the diff. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, declined and why, or raised with me), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
buildBugUrl:
  8. Once the PR is open, run ONE round of adversarial review: spawn a subagent with its model set to Opus (e.g. the Agent tool's `model: "opus"` — left unset, it typically inherits yours), whatever model you are yourself, to review the PR antagonistically — briefed without your reasoning, and report-only (no edits, commits, or pushes). Run it in the foreground and wait for its report; that wait is your own work, not a check-in. Fix the in-scope findings you verify as legitimate and push; raise real but out-of-scope ones with me rather than widening the diff. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, declined and why, or raised with me), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
buildRefinementUrl:
  (none)
buildSpikeUrl:
  (none)
buildEpicRefinementUrl:
  (none)
buildEpicImplementationUrl:
  (none)

=== the skip-refinement prompt, end to end ===
ALF-42: Verify the GitHub webhook HMAC signature

You are implementing the ticket ALF-42. This is a SKIP-REFINEMENT session: there is NO committed spec to read — settle the plan here, then build it directly in this one session.

1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base your work on the code that already exists.
2. If the title and context below don't pin down the scope, ASK ME HERE before building rather than guessing — you don't need to guess, I'm in this tab. Once the plan is settled, go ahead.
3. Implement the change directly, following the repo's own conventions (tests/TDD included) — pin each requirement with a test.
4. When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly:

```alfred
alfred-ticket: ALF-42
phase: implementation
```

5. Before opening the PR, confirm your changes satisfy the agreed plan and the block above is reproduced exactly.
6. Once the PR is open, run ONE round of adversarial review: spawn a subagent with its model set to Opus (e.g. the Agent tool's `model: "opus"` — left unset, it typically inherits yours), whatever model you are yourself, to review the PR antagonistically — briefed without your reasoning, and report-only (no edits, commits, or pushes). Run it in the foreground and wait for its report; that wait is your own work, not a check-in. Fix the in-scope findings you verify as legitimate and push; raise real but out-of-scope ones with me rather than widening the diff. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, declined and why, or raised with me), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)


Context (from the ticket):
Two review rounds, please.
````

## The skill the step points at

```bash
grep -E '^(name:|#)' .claude/skills/adversarial-review/SKILL.md
```

```output
name: adversarial-review
# Adversarial review
## Spawn it, then wait
## Brief it cold
## Triage every finding
## Record it on the PR
```

## The implement-spec and bug skills end in dispatch, repair, record

Each skill walks its work as numbered steps whose last three are the review round: dispatch the Opus reviewer (report-only, briefed per the adversarial-review skill's checklist, waited on in the foreground), repair what it finds, and record every disposition on the PR.

```bash
grep -oE '^[0-9]+\. \*\*[^*]+\*\*' .claude/skills/implement-spec/SKILL.md .claude/skills/bug/SKILL.md
```

```output
.claude/skills/implement-spec/SKILL.md:1. **Ground in the codebase.**
.claude/skills/implement-spec/SKILL.md:2. **Ask when the spec is ambiguous or stale.**
.claude/skills/implement-spec/SKILL.md:3. **Build it test-first, pinning every requirement with a test**
.claude/skills/implement-spec/SKILL.md:4. **Archive the spec and open the PR**
.claude/skills/implement-spec/SKILL.md:5. **Dispatch the adversarial reviewer.**
.claude/skills/implement-spec/SKILL.md:6. **Repair.**
.claude/skills/implement-spec/SKILL.md:7. **Record the round.**
.claude/skills/bug/SKILL.md:1. **Reproduce.**
.claude/skills/bug/SKILL.md:2. **Pin it red.**
.claude/skills/bug/SKILL.md:3. **Fix the cause.**
.claude/skills/bug/SKILL.md:4. **Check the blast radius.**
.claude/skills/bug/SKILL.md:5. **Open the PR**
.claude/skills/bug/SKILL.md:6. **Dispatch the adversarial reviewer.**
.claude/skills/bug/SKILL.md:7. **Repair.**
.claude/skills/bug/SKILL.md:8. **Record the round.**
```
