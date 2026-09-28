---
branch: claude/alf-282-opus-adversarial-review-c1ld62
---

# Opus adversarial review on every code-lane PR (ALF-282)

*2026-09-28T13:07:08.992Z*

ALF-282: once an implementation, skip-refinement, or bug-fix session has opened its PR, it now spawns an Opus review subagent (whatever model the implementer is), waits for its report, fixes the findings it verifies as legitimate, pushes, and records every finding's disposition (fixed, or declined and why) in an "Adversarial review" section of the PR description. One round by default; the ticket notes, which the prompt appends after this step, can ask for more or none. The step lives in the three launch prompts themselves, because the skip-refinement and bug lanes never load implement-spec and a session has stopped reading files by the time its PR is open. The how (briefing the reviewer cold, triage, the audit trail) lives in a new adversarial-review skill that each prompt points at.

## Every launch prompt, built by the real link builders

The three code lanes carry the identical step (bar its step number). The two document lanes (refinement, spike) and the two epic lanes carry none.

```bash
node --no-warnings docs/demos/alf-282-adversarial-review/print-review-step.mjs
```

````output
buildImplementationUrl:
  Once the PR is open, run ONE round of adversarial review: spawn a subagent on Opus — whatever model you are — to review the PR cold and antagonistically, wait for its report, fix the findings you verify as legitimate, and push. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, or declined and why), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
buildBypassUrl:
  6. Once the PR is open, run ONE round of adversarial review: spawn a subagent on Opus — whatever model you are — to review the PR cold and antagonistically, wait for its report, fix the findings you verify as legitimate, and push. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, or declined and why), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
buildBugUrl:
  8. Once the PR is open, run ONE round of adversarial review: spawn a subagent on Opus — whatever model you are — to review the PR cold and antagonistically, wait for its report, fix the findings you verify as legitimate, and push. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, or declined and why), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
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
6. Once the PR is open, run ONE round of adversarial review: spawn a subagent on Opus — whatever model you are — to review the PR cold and antagonistically, wait for its report, fix the findings you verify as legitimate, and push. Then add an "Adversarial review" section to the PR description listing each finding and what you did with it (fixed, or declined and why), leaving the alfred block intact. Follow the adversarial-review skill at `.claude/skills/adversarial-review/SKILL.md` where present — it owns how to brief the reviewer and triage its findings. If the ticket context below says otherwise (more rounds, or none), follow it.
Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)


Context (from the ticket):
Two review rounds, please.
````

## The skill the step points at

```bash
sed -n '/^# Adversarial review/,$p' .claude/skills/adversarial-review/SKILL.md
```

```output
# Adversarial review

> This skill is **dropped into each project repo** at `.claude/skills/adversarial-review/SKILL.md`.
> The implementation, skip-refinement, and bug-fix launch prompts from our agent orchestrator
> (alfred) each carry a review step that points here.

Once your PR is open, it gets one round of review from a **fresh Opus subagent** — whatever model
you are, Opus included. You wrote the change, so you share its blind spots; a reviewer with none of
your context is the cheapest way to catch what the gates can't: a requirement misread, a test that
would pass without the change, an edge case nobody pinned.

**One round is the default.** The ticket context (the notes at the end of the launch prompt) can
override it — more rounds, a named focus, or no review — and when it does, follow it.

## Spawn it, then wait

Set the model explicitly — in Claude Code, the Agent tool with `model: "opus"` — and run it in the
foreground: its report is your next input. Waiting on it is your own work, not a check-in on the
PR. If you can't get an Opus reviewer, say so to the human and in the PR rather than quietly
reviewing the change yourself.

## Brief it cold

It can't ask you anything, and it shouldn't inherit your reasoning — arguing your approach up front
anchors the reviewer and defeats the point. Give it:

- **What was asked:** the ticket ref, title, and context, plus the plan — the spec's path, the plan
  you settled with the human (skip-refinement), or the reproduction and root cause (bug).
- **Where to look:** the PR number, its diff against the base (e.g. `git diff origin/main...HEAD`),
  and the repo's CLAUDE.md / CONTRIBUTING.
- **Its job:** be adversarial — hunt for bugs, unmet or misread requirements, tests that don't
  actually pin the behavior, missed edge cases, and convention breaks. Each finding carries
  `file:line`, the evidence, a severity, and a concrete fix.
- **Its limits:** report only — no edits, commits, pushes, or GitHub comments.

## Triage every finding

- **Verify before you act.** Reproduce it or trace it in the code; a finding is a claim, not a fact.
- **Legitimate → fix it**, test-first when it's behavioral, through the normal gates.
- **Declining needs evidence, not preference.** The reviewer may be the stronger model: a false
  premise or a contradicting requirement is a reason, "I disagree" isn't.
- **Real but out of scope → tell the human** in the tab rather than widening the diff.

## Record it on the PR

Push the fixes, then add an **Adversarial review** section to the PR description: one line per
finding with its disposition — *fixed* (the commit), *declined* (why), or *raised with the human*.
No findings is still a line. The human audits your declines here, so a decline without a reason is
a bug. Leave the `alfred` block exactly as it was; the CI check re-reads it on every edit.
```

## The implement-spec and bug skills cross-reference it

```bash
grep -n 'adversarial-review' .claude/skills/implement-spec/SKILL.md .claude/skills/bug/SKILL.md
```

```output
.claude/skills/implement-spec/SKILL.md:54:- **Get the open PR reviewed** — one round of the adversarial-review skill, skip-refinement
.claude/skills/bug/SKILL.md:41:6. **Get it reviewed.** Once the PR is open, run the adversarial-review skill's round.
```
