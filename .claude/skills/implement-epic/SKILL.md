---
name: implement-epic
description: >
  Describes the epic one-shot workflow: ONE orchestrator session that builds a whole epic from its
  committed epic spec by dispatching an implementer subagent per slice, then ships the lot in a
  single PR. Read whenever you're handed an EPIC to build: an epic-implementation session, or a
  prompt asking you to orchestrate subagents across an epic spec and open a PR carrying
  `phase: epic-implementation`. Trigger on: "implement the epic", "one-shot the epic", "orchestrate
  the epic", "dispatch implementer subagents", "epic orchestrator", or an epic-implementation launch
  prompt. For one story built from its own spec use the implement-spec skill; to write the epic
  spec, epic-refinement.
---

# Implementing an epic in one session

> This skill is **dropped into each project repo** at `.claude/skills/implement-epic/SKILL.md`.
> An epic-implementation session triggered by our agent orchestrator (alfred) auto-loads it; the
> launch prompt also points here.

You are the **orchestrator** for one epic. The committed **epic spec is the plan** — the whole of
it is in scope — and your job is to get it built, integrated, and into a single PR. You do that by
**cutting the epic into slices and dispatching an implementer subagent per slice**, not by typing
every line yourself.

This lane exists so an epic can ship **without being split into stories by hand first**. Nobody
refined these slices; you are doing that work in-session, at speed, which is exactly why the rules
below are about not fooling yourself.

## You cannot create tickets

The session has no write access to the orchestrator. So when the spec implies work you end up
leaving out — out of scope, too big, blocked on a decision — **say so to the human in the tab**.
Do not invent a ref for it, do not add it to the PR block, do not leave it as a TODO nobody sees.
A made-up ref names nothing; a human reading the PR is the only route from "not done" to "tracked".

The same goes for scope you *are* covering: the block names the **epic's** ref, once. You never
enumerate story refs, because the point of this lane is that no stories were cut.

## Slice the epic before you dispatch anything

Read the epic spec end to end first, then the code it touches. Only then cut slices, and cut them
so the subagents don't collide:

- **Foundations first, alone.** A migration, a shared type, a new primitive component, a store — if
  more than one slice needs it, build it yourself (or in a single first subagent) and let the fan-out
  start from a repo that already has it. Two agents inventing the same helper is the default failure.
- **Slice by vertical behavior, not by layer.** "Filing a story from the inbox" beats "all the API
  routes" — a layer slice can't be tested on its own and lands half-working.
- **Give each slice a file boundary.** Two subagents editing one file is the other default failure:
  the second one's write lands on a file it never read.
- **Parallel when disjoint, serial when not.** Dispatch a batch whose slices share no files; wait,
  integrate, then dispatch the next. Dependencies are a reason to serialize, not to hope.

## Brief each subagent like it can't ask you a question

Because it can't. Every dispatch carries: the epic spec's path, the slice's behavior and its
acceptance criteria in your own words, the files it owns, the repo conventions that apply (its
CLAUDE.md, the neighbouring patterns), and **the instruction to pin the behavior with tests**.
Tell it what's out of its slice, too — an unbriefed agent helpfully "fixes" a neighbour's file.

Subagents write code and tests. **They do not commit, push, or open PRs** — you do, once, at the end.

## You own integration and the gates

Their work is a draft until you've read it. After each batch: read the diff yourself, reconcile the
seams (duplicate helpers, drifting names, a type two slices define differently), and **run the
repo's full check suite** — not the slice's tests. A green subagent report is not a green repo.

Fix integration breaks yourself rather than dispatching a fix-it agent into a file three slices
touched.

## The epic spec is not scaffolding

A story spec is consumed by the PR that implements it and gets archived. **An epic spec is not** —
it's long-lived context later sessions keep reading. Leave it exactly where it sits: don't edit it,
don't archive it, don't move it, and don't "update it to match what you built". If the build
diverged from the spec, that's something to tell the human, who decides whether the spec is now
wrong or the build is.

## The PR

One PR for the epic, whose description carries the block verbatim:

````markdown
```alfred
alfred-ticket: <EPIC-REF>
phase: epic-implementation
```
````

- `alfred-ticket` is the **epic's** ref, and `phase` is **`epic-implementation`** — that phase is
  what stops the orchestrator routing an epic's ref at the story table, where it can never match.
- **No `spec-path`.** The epic spec is already recorded against the epic, and naming it here would
  invite the archive rule that retires *story* specs.
- Say in the description what you left out and why — that list is the human's queue.

**Merging this PR advances nothing in the orchestrator.** An epic carries no lifecycle state, so
the board won't move when the epic ships: tell the human to archive the epic themselves once it's
merged.

## When to stop and ask

The failure mode here isn't a wrong plan, it's a *plausible* one built eight ways in parallel
before anyone looks. Stop and ask the human in the tab — they're right there — when the spec is
ambiguous or has drifted from the code, when a slice turns out to be a project of its own, or when
two slices want the same file and you can't see how to split them. Then build everything that
*isn't* blocked on the answer.
