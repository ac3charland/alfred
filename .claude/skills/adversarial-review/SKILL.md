---
name: adversarial-review
description: >
  Describes the adversarial review round an implementation, skip-refinement, or bug-fix session
  runs on its own PR once it's open — briefing an Opus review subagent and triaging its findings.
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

**Adversarial means independent, not obliged to object.** A model told to find fault finds it
whether or not it's there, and the author on the receiving end, challenged, "fixes" code that was
right. So the brief makes "nothing blocking" a full answer, and triage demands evidence before
anything changes.

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
  you settled with the human (skip-refinement), or the bug report and how to reproduce it (bug;
  withhold your diagnosis so it judges the root cause for itself).
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
- **Its job and report:** the block below, as written.
- **Its limits:** report only — no edits, commits, pushes, or GitHub comments. Running the tests
  and read-only commands is fine; an experiment that changes files (reverting the fix to watch a
  test fail) goes in a scratch copy, never the checkout under review — you push from it.

```text
Your job is a verdict: does this change do what was asked, correctly? Be independent: trust
nothing the PR claims until you've checked it, and prefer running (the tests, the repro, the demo
doc's commands) to reasoning. "Nothing blocking" is a complete, successful review. You are not
scored on how many findings you return, and each one costs the author a verification cycle.

Check that every requirement is met (for a bug fix: its root cause, not just the symptom) and
pinned by a test that would fail without the change; the edge cases the change creates; and the
repo's CLAUDE.md conventions. Skip what the type-check, lint, and format gates enforce; they ran.

Report, in this order:
1. Verdict, one line: ship it / ship once the blocking findings are fixed / rethink, and why.
2. Verified: what you checked and found sound, one line each.
3. Findings, each with file:line, one label, and a concrete fix:
   - blocking: give the failure scenario (this input or state -> this happens -> this should).
     No scenario, not blocking.
   - question: you can't tell whether it's intended; ask rather than assert.
   - nit: correct as written; a preference or polish.
   - pre-existing: a real problem this PR didn't introduce.
```

Add a named focus from the ticket, but don't rewrite the block into a hunt:

- **Never presume bugs.** "Find the problems", a quota, or "there's a bug in here" gets problems
  back, invented if need be — the same pull to please that makes a model agree with you, aimed at
  the brief. The *Verified* list gives "it's fine" somewhere to go.
- **Ask for a scenario, not a score.** Models rate severity poorly; a failure scenario is a claim
  you can check.
- **Label nits; don't forbid them.** Prompting a reviewer to hold back nits holds back real
  findings with them. Triage filters them instead.

## Triage every finding

A finding is a claim, and so is its label. Being challenged is exactly when a model talks itself
out of a right answer, so hold both directions to the same bar:

- **Act only on a failure you've reproduced** — traced in the code or, when it's behavioral, a red
  test — then fix it through the normal gates. One you can't reproduce isn't a bug, however
  confident the reviewer.
- **Demo findings first** — fixing the behavior can moot or move the code findings. Work out
  whether it's the behavior or the capture: wrong behavior that got past the suite gets a red test,
  the fix, then a re-capture; right behavior with missing or unfitting evidence gets captured
  properly. Never stage the demo to pass.
- **Decline only with counter-evidence:** the passing repro, the requirement it contradicts, the
  false premise. "I disagree" isn't a reason.
- **Re-label as you verify.** A *blocking* finding that won't reproduce is declined; a *nit* or
  *question* that exposes a real gap is blocking.
- **Nits:** take one only when it's plainly right, cheap, and in lines the PR already touches;
  otherwise decline it in a line.
- **Questions:** answer them from the ticket and plan; the answer is the disposition.
- **Pre-existing, or real but out of scope → tell the human** in the tab rather than widening the
  diff.
- **A clean report is a result, not a miss.** Don't re-brief or re-run the reviewer to shake
  findings loose; extra rounds come only from the ticket.

## Record it on the PR

Push the fixes, then add an **Adversarial review** section to the PR description: the reviewer's
verdict, then one line per finding with its disposition — *fixed* (the commit), *declined* (why),
*answered*, or *raised with the human*. No findings is still a line. The human audits your declines
here, so a decline without a reason is a bug. Leave the `alfred` block exactly as it was; the CI
check re-reads it on every edit.
