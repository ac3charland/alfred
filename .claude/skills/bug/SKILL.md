---
name: bug
description: >
  Describes the bug-fix workflow for a `Bug: …` story — the one session that takes a defect from
  report to merged fix, with no refinement phase and no spec in between. Read whenever you're
  handed a bug: a bug-fix session, a story titled `Bug: …`, or a prompt asking you to reproduce
  and fix a defect. Trigger on: "fix the bug", "bug-fix session", "reproduce the bug", "root
  cause", "regression test", "it used to work", or a bug launch prompt. For work built from a
  committed spec use the implement-spec skill; for a research question, the spike skill — a bug
  restores behavior the app already promised rather than describing new work.
---

# Bug fix

> This skill is **dropped into each project repo** at `.claude/skills/bug/SKILL.md`.
> A bug-fix session triggered by our agent orchestrator (alfred) auto-loads it; the launch prompt
> also points here. It's a committed convention so fixes are consistent and the orchestrator's
> webhook Worker can rely on the PR shape.

You are in a **bug-fix** session for a `Bug: …` story. A bug skips refinement for the same reason
a spike does — there is nothing worth specifying until you know what is actually broken — but
where a spike ends in a document, this session ends in **code**: a test that was red for the
bug's reason, and the fix that turned it green.

**Before you change anything:** ground yourself in this repo (skim the structure, read any
`CONTRIBUTING`/`CLAUDE.md`), then **reproduce the bug**. If you can't, say so and ask the human —
they launched this session and are in the tab. A fix for a defect you never observed is a guess
wearing a diff.

## The loop

1. **Reproduce.** Get the wrong behaviour to happen on demand — a failing command, a request, a
   click path. Report what you found: what you see, what you expected, and the code responsible.
2. **Pin it red.** Write the test that fails *because* the bug exists, at the tightest level that
   captures it (unit → Storybook play → E2E, in that order of preference). **Watch it fail**, and
   read the failure: a test that passes before the fix is testing something else.
3. **Fix the cause.** Then watch the same test go green.
4. **Check the blast radius.** Run the repo's own checks and re-read the diff for anything else
   that relied on the broken behaviour.
5. **Open the PR** with the `alfred` block below.

## The PR

A bug's PR is an **implementation** PR — the ticket goes `in_development → ready_for_review` when
it opens and `→ done` when it merges, exactly as an ordinary story's does. So the block carries
`phase: implementation`, and **no `spec-path`**: this session writes no document, so naming one
would point at a file that doesn't exist.

````markdown
```alfred
alfred-ticket: <REF>
phase: implementation
```
````

## Rules

- **The failing test comes first, and it is not optional.** It's what makes the fix a fix rather
  than a change: it proves the defect was real, proves the patch addresses *it*, and stops the
  same regression landing again. A test written after the code passes only proves the code does
  what it now does. If a bug is genuinely untestable (a build script, a one-line config typo),
  say so in the PR description rather than skipping the step silently.
- **Fix the root cause, not the symptom.** Trace the wrong value back to where it was first
  wrong. Clamping a `NaN` at the render site leaves the bug alive one layer up, and the next
  ticket is the same bug wearing different clothes.
- **Keep the blast radius small.** The fix covers this defect and whatever else is broken for the
  same reason — nothing more. Found an adjacent bug? Tell the human; it's a new story, not a
  bigger diff. Refactors that "clean up while we're in here" hide the fix from its reviewer.
- **Nothing to archive.** There's no committed spec behind a bug, so — unlike an implementation
  PR — nothing is git-moved into `docs/specs/archive/`, and the `alfred-frontmatter` check has no
  archive rule to satisfy here.
- **One story per bug PR.** Iteration happens in review comments on that PR.
- **Say so when it isn't a bug.** If the behaviour turns out to be correct, already fixed, or a
  feature request wearing a `Bug:` prefix, stop and tell the human. Closing a story as
  "not a bug" is a real outcome; inventing a defect to justify the session is not.
