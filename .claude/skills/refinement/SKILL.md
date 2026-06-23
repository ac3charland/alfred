---
name: refinement
description: >
  Describes the refinement workflow for turning a code ticket into a spec. 
  Read whenever you're handed a ticket to refine into a spec: a refinement
  session, or a prompt asking for a SPEC ONLY plus a spec-carrying PR. Trigger on: "refine the
  ticket", "refinement session", "write the spec for", "spec-only PR", "refinement PR", or a
  refinement launch prompt.
---

# Refinement

> This skill is **dropped into each project repo** at `.claude/skills/refinement/SKILL.md`.
> A refinement session triggered by our agent orchestrator (alfred) auto-loads it; the launch prompt also points here. 
> It's a committed convention so refinement output is consistent and the orchestrator's webhook Worker can rely on the PR shape.

You are in a **refinement** session for a story. Your job is to **write a spec** — **not to
implement anything**. Produce one spec artifact and open a PR; that is the entire deliverable.

**Before you write anything:** ground yourself in this repo (skim the structure and read any
`CONTRIBUTING`/`CLAUDE.md`), then decide whether you actually have enough to spec. If the story
title + notes don't pin down the scope and acceptance criteria, **ask the human first** — they
launched this session and are in the tab, so questions are cheap; an invented spec is not. Only
once the scope is clear do you write the spec below.

## What to produce

1. **A spec authored as a self-contained HTML plan at `docs/specs/<REF>.html`** (e.g.
   `docs/specs/ALF-42.html`, using the story's ref). Write it as a rich, scannable document a human will actually open and review, not a wall of prose:
   - **One self-contained file:** inline all CSS in a `<style>` block; no build step, no external
     dependencies, no JS required — it opens directly in a browser. Make it easy to read and
     digest, and mobile-friendly.
   - **Title:** `<title>` and a top `<h1>` of `<REF> — <story title>`, so the browser tab is scannable.
   - **Context / problem:** what we're solving and why, drawn from the story title + notes + user feedback.
   - **Proposed change:** the concrete behavior to build. Use the format that conveys it best —
     tables for option/field matrices, an inline **SVG** diagram for any data flow or state machine,
     annotated snippets of the key code a reviewer would want to see, and a small mockup where a UI
     is involved.
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
   spec-path: docs/specs/<REF>.html
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
- **Iterate via PR comments.** Refinement back-and-forth happens in review comments on this PR.
