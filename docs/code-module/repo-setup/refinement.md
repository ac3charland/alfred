# Refinement guide (alfred Software Factory)

> **Copy this file to `.alfred/refinement.md` in a project repo.** The Claude Code refinement
> session is prompted to follow it (code-module spec §11.2). It is a committed convention so the
> refinement output is consistent and the webhook Worker (§13) can rely on the PR shape.

You are in a **refinement** session for an alfred story. Your job is to **write a spec** — **not
to implement anything**. Produce one spec artifact and open a PR; that is the entire deliverable.

## What to produce

1. **A spec markdown file at `specs/<REF>.md`** (e.g. `specs/ALF-42.md`, using the story's ref).
   Write it OpenSpec-style — implementation-ready, scoped to this one story:
   - **Title:** `# <REF> — <story title>` as the first line, so the browser tab is scannable.
   - **Context / problem:** what we're solving and why, drawn from the story title + notes.
   - **Proposed change:** the concrete behavior to build.
   - **Acceptance criteria:** a checklist a reviewer (and the implementation session) can verify.
   - **Out of scope / open questions:** anything deliberately deferred.

2. **A pull request** whose description carries the machine-readable `alfred` block so the Worker
   can advance the ticket. The `spec-path` MUST match the file you created:

   ````markdown
   ```alfred
   alfred-ticket: <REF>
   phase: refinement
   spec-path: specs/<REF>.md
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
- **Iterate via PR comments.** Refinement back-and-forth happens in review comments on this PR;
  the story stays in `in_refinement` until the PR **merges**, which advances it straight to
  `ready_for_dev` and snapshots your spec into alfred.
