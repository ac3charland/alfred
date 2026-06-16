---
name: refinement
description: >
  Describes the refinement workflow for turning a code ticket into a spec: in a refinement
  session you write one spec artifact and open the pull request that advances the ticket — no
  implementation. Read whenever you're handed a ticket to refine into a spec: a refinement
  session, or a prompt asking for a SPEC ONLY plus a spec-carrying PR. Trigger on: "refine the
  ticket", "refinement session", "write the spec for", "spec-only PR", "refinement PR", or a
  refinement launch prompt.
---

# Refinement (the Software Factory spec step)

> This skill is **dropped into each project repo** at `.claude/skills/refinement/SKILL.md`.
> A refinement session auto-loads it; the launch prompt also points here. It's a committed
> convention so refinement output is consistent and the webhook Worker can rely on the PR shape.

You are in a **refinement** session for a story. Your job is to **write a spec** — **not to
implement anything**. Produce one spec artifact and open a PR; that is the entire deliverable.

**Before you write anything:** ground yourself in this repo (skim the structure and read any
`CONTRIBUTING`/`CLAUDE.md`), then decide whether you actually have enough to spec. If the story
title + notes don't pin down the scope and acceptance criteria, **ask the human first** — they
launched this session and are in the tab, so questions are cheap; an invented spec is not. Only
once the scope is clear do you write the spec below.

## What to produce

1. **A spec markdown file at `docs/specs/<REF>.md`** (e.g. `docs/specs/ALF-42.md`, using the
   story's ref). Write it OpenSpec-style — implementation-ready, scoped to this one story:
   - **Title:** `# <REF> — <story title>` as the first line, so the browser tab is scannable.
   - **Context / problem:** what we're solving and why, drawn from the story title + notes.
   - **Proposed change:** the concrete behavior to build.
   - **Acceptance criteria:** a checklist a reviewer (and the implementation session) can verify.
   - **Out of scope / open questions:** anything deliberately deferred. Resolve the questions you
     *can* answer with the human up front (see above) and list only the genuinely-open ones here
     — this section is for deferred decisions, not for guesses you didn't check.

2. **A pull request** whose description carries the machine-readable `alfred` block so the Worker
   can advance the ticket. The `spec-path` MUST match the file you created:

   ````markdown
   ```alfred
   alfred-ticket: <REF>
   phase: refinement
   spec-path: docs/specs/<REF>.md
   ```
   ````

## Rules

- **No implementation.** No app/source changes in a refinement PR — only the spec file (and, if
  needed, supporting docs). Implementation happens later, in a separate session, after this PR merges.
- **One story per refinement PR**, unless explicitly told to batch (then list every ref in
  `alfred-ticket`, comma-separated).
- **The `alfred` block is required** and is enforced by the `alfred-frontmatter` check — a PR
  missing or malforming it (or omitting `spec-path` on a refinement PR) fails CI. Fix the
  description if the check is red.
- **Ask when context is thin.** If the title + notes don't pin down scope or acceptance, ask the
  human in this session *before* writing the spec — don't guess. Putting a guess in the spec just
  defers the error to the implementation session.
- **Not a clean one-story spec? Say so.** If the story is too big for a single spec, isn't
  actually a story (a question, a bug report, a duplicate of existing behavior), or can't be
  scoped from what you have, stop and tell the human — propose a split or a next step instead of
  forcing a spec to exist.
- **Iterate via PR comments.** Refinement back-and-forth happens in review comments on this PR;
  the story stays in `in_refinement` until the PR **merges**, which advances it straight to
  `ready_for_dev` and snapshots your spec into alfred.
