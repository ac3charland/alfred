---
name: adversarial-review
description: >
  Describes the adversarial review round an implementation, skip-refinement, or bug-fix session
  runs on its own PR once it's open — spawning an Opus review subagent and acting on its findings.
  Read right after opening an implementation-phase PR, or whenever a prompt asks for an
  adversarial, antagonistic, or Opus review of your change. Trigger on: "adversarial review",
  "antagonistic review", "Opus review", "review subagent", "spawn a reviewer", "red-team the PR",
  "review round", or a launch prompt's review step. Pairs with the implement-spec and bug skills;
  not for reviewing someone else's PR.
---

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
  you settled with the human (skip-refinement), or the bug report and how to reproduce it (bug; let
  the reviewer judge whether the fix hits the root cause rather than handing it your diagnosis).
- **Where to look:** the PR number, its diff against the base, and the repo's CLAUDE.md /
  CONTRIBUTING. Fetch the base before diffing against it (the git skill's stale-main trap).
- **Its first step:** read the PR's demo doc before the diff — the brief names its path, or says
  there is none and why (the repo exempts the change, or the human waived it). Judge its
  *evidence* — open every screenshot and captured output, and check it's current; the prose is the
  author's claim, not proof — against what was asked (the ticket and its spec or plan), in the form
  the repo's demo conventions call for (a UI change shown, not test output). If it doesn't show each
  required behavior actually happening — or there's no demo where the repo owes one — that is the
  report's **first finding**, ahead of the code findings: a diff that reads right can still do the
  wrong thing. It then finishes the code review; the round isn't spent on the demo alone.
- **Its job:** be adversarial — hunt for bugs, unmet or misread requirements, tests that don't
  actually pin the behavior, missed edge cases, and convention breaks. Each finding carries
  `file:line`, the evidence, a severity, and a concrete fix.
- **Its limits:** report only — no edits, commits, pushes, or GitHub comments.

## Triage every finding

- **Verify before you act.** Reproduce it or trace it in the code; a finding is a claim, not a fact.
- **Legitimate → fix it**, test-first when it's behavioral, through the normal gates. Take a demo
  finding first — fixing the behavior can moot or move the code findings — and work out whether it's
  the behavior or the capture. Wrong behavior that got past the suite gets a red test, the fix, then
  a re-capture; right behavior with missing or unfitting evidence gets captured properly. Never
  stage the demo to pass.
- **Declining needs evidence, not preference.** The reviewer may be the stronger model: a false
  premise or a contradicting requirement is a reason, "I disagree" isn't.
- **Real but out of scope → tell the human** in the tab rather than widening the diff.

## Record it on the PR

Push the fixes, then add an **Adversarial review** section to the PR description: one line per
finding with its disposition — *fixed* (the commit), *declined* (why), or *raised with the human*.
No findings is still a line. The human audits your declines here, so a decline without a reason is
a bug. Leave the `alfred` block exactly as it was; the CI check re-reads it on every edit.
