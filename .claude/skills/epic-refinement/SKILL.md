---
name: epic-refinement
description: >
  Describes the epic-refinement workflow for turning an epic into a durable context-and-decisions
  document. Read whenever you're handed an EPIC to refine: an epic-refinement session, or a prompt
  asking for an EPIC SPEC ONLY plus a PR carrying `phase: epic-refinement`. Trigger on: "refine the
  epic", "epic refinement", "epic spec", "write the epic spec", "brainstorm the epic", "phase:
  epic-refinement", or an epic-refinement launch prompt. For a single story/ticket spec, use the
  refinement skill instead — this one sits an altitude above it.
---

# Epic refinement

> This skill is **dropped into each project repo** at `.claude/skills/epic-refinement/SKILL.md`.
> An epic-refinement session triggered by our agent orchestrator (alfred) auto-loads it; the launch
> prompt also points here. It's a committed convention so epic specs are consistent and the
> orchestrator's webhook Worker can rely on the PR shape.

You are in an **epic-refinement** session. Your job is to **brainstorm the epic with the human and
write down what you settle on** — not to implement anything, and not to spec the individual
stories. One epic spec plus a PR is the entire deliverable.

**Brainstorming is the point, not a preliminary.** The human opened this session because the epic's
shape isn't written down anywhere yet. So ground yourself in the repo first (skim the structure,
read any `CONTRIBUTING`/`CLAUDE.md`, look at the code the epic touches), then **talk it through with
them** — propose the framing you'd use, name the decisions you think the epic hinges on, say where
you're guessing. They're in the tab. A spec written from a confident guess is worse than no spec,
because every story session downstream inherits the guess.

## What an epic spec is

**Durable context for a body of work** — the problem space, the decisions taken and why, the
constraints, what's deliberately out. It is read by **every later story session in the epic**, which
is what makes it worth writing: without it, each story's refinement re-derives the same background
and two stories in one epic end up specced against two different mental models.

What it is **not**:

- **Not a buildable change.** No implementation, no per-file plan. A story spec describes a concrete
  change a session can build; an epic spec describes the world that change lives in.
- **Not a story breakdown to implement from.** Sketching how the work might split into stories is
  useful and belongs here — but as a *sketch*. Each story gets its own refinement session, and a
  spec-shaped section per story here would just be a stale rival to those.

## What to produce

**One self-contained HTML document at `docs/specs/epics/<EPIC-REF>.html`** (e.g.
`docs/specs/epics/ALF-12.html`, using the *epic's* ref). Epic specs live in their own folder,
separate from the active story specs, because they never leave it (see *Never archived* below).

The authoring rules are the **same as a story spec's** — inline all CSS, no external dependencies,
no JS required, mobile-friendly, `<title>` and `<h1>` of `<EPIC-REF> — <epic name>`. The
[`refinement`](../refinement/SKILL.md) skill's "What to produce" section is the source of truth for
those mechanics; don't re-derive them, and don't let the two drift.

Cover these, in whatever order and format reads best (tables for option matrices, an inline SVG for
an architecture or data flow, a small mockup where UI is involved):

- **Problem space & why now** — what this epic is about and what makes it worth a body of work.
- **Decisions, each with its rationale.** The heart of the document. A decision without its *why*
  gets re-litigated by the first story session that finds it inconvenient.
- **Architecture / data model the epic assumes** — the shape later stories build against.
- **Constraints and non-goals** — including things deliberately deferred, so a story session
  doesn't "helpfully" pull them in.
- **How the work splits into stories** — a sketch: a list of the slices you'd cut and why, not
  specs.
- **Open questions** — genuinely open ones. Anything you *can* settle with the human in this
  session, settle here instead of parking it.

## Refining again updates the same file

An epic has **at most one spec**. When the epic already carries one (the launch prompt names its
path when it does), **revise that file in place** — record what changed and why it changed, so the
document reads as the epic's current state with its history intact. A second document just splits
the context every story session is supposed to read from one place.

**A round that settles something invalidates the earlier drawings too.** Sweep the whole document
for mockups and captions still illustrating the old answer, not just the section you're editing —
an epic states its rules more than once, and a stale illustration outlives the prose that once
justified it. Downstream story sessions read the picture and re-state what it shows.

## The PR

Open a pull request whose description carries the machine-readable `alfred` block, so the Worker can
attach the spec to the epic:

````markdown
```alfred
alfred-ticket: <EPIC-REF>
phase: epic-refinement
spec-path: docs/specs/epics/<EPIC-REF>.html
```
````

- `alfred-ticket` is the **epic's** ref, and `phase` is **`epic-refinement`** — that phase is what
  routes the Worker at the epic instead of a story. `spec-path` must match the file you wrote.
- **Add the `htmlpreview.github.io` link** to the rendered spec on this PR's head branch, for the
  same reason and in the same form the [`refinement`](../refinement/SKILL.md) skill documents (GitHub
  serves a committed `.html` as raw source, so a reviewer can't otherwise read it).
- The `alfred-frontmatter` check enforces the block and requires `spec-path` on this phase. Fix the
  description if it's red.

## Never archived

An implementation PR retires a *story* spec by git-moving it into `docs/specs/archive/`. **An epic
spec is exempt**: it's long-lived context that story prompts keep pointing at, so it stays exactly
where it is, forever. Nothing archives it, and no later session should move it — its own
`docs/specs/epics/` folder keeps it structurally clear of that rule.

## Rules

- **No implementation.** No app or source changes in an epic-refinement PR — only the epic spec
  (and, if needed, supporting docs).
- **No per-story specs.** Stories are refined in their own sessions.
- **Ask when the context is thin.** This session is more open-ended than a story refinement, which
  makes guessing both easier and more costly — a guess here propagates to every story in the epic.
- **A visual constraint no epic mockup draws propagates.** The
  [`refinement`](../refinement/SKILL.md) rule applies — a requirement the picture doesn't show was
  never signed off — and it bites harder at this altitude: story sessions inherit the constraint and
  re-state it, often more forcefully than the epic did, while still pointing at a mockup that never
  drew it. So if the epic asserts what a surface looks like, draw it in the epic's own mockup, or
  leave it as an open question for the story that owns that surface.
- **Not actually an epic? Say so.** If it's really a single story, or two unrelated bodies of work
  wearing one name, stop and tell the human — propose the split instead of forcing one document to
  cover both.
- **Iterate via PR comments**, like story refinement.
