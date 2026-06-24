---
name: implement-spec
description: >
  Documents the house style for implementing a written spec, ticket, or design doc into
  code. Read whenever you've been handed a spec, ticket, or design doc and asked to build
  it. Trigger on: "implement this spec", "build the spec", "implement the ticket", "build
  specs/ALF-*.md", "the refinement spec", "implement from the design doc", or starting any
  work from a written specification.
---

# Implementing a spec

A spec is **scaffolding**: it gets the right code written, then the code, its tests, and its
comments outlive it. Write for the next reader, who opens the file with the code in front of
them and **not the spec** — the implementation has to stand on its own.

## Never carry spec-only references into the code

A spec's section numbers, headings, figure/table labels, and milestone names are coordinates
into *that document* — in a comment, commit, PR, or test name they're dangling pointers no
later reader can resolve, and they rot when the spec is renumbered or retired. Translate the
meaning into self-contained prose, or drop the citation when the sentence already stands alone:

- `… deep links (§11).` → `… deep links.`
- `the ToS-clean human launch (§1/§11.1)` → `the ToS-clean human launch — prefilled, never auto-submitted`

This bans *unresolvable* references, not all of them: a file path, a symbol, a stable central
doc (`README §3`, a CLAUDE.md heading), or an external doc (`PostgreSQL docs §7.8`) is fine —
the reader can open it with only the repo in hand. Only the spec you're implementing fails
that test, because it isn't part of the delivered code.

## Archive the spec on the implementation PR

A spec is consumed once you build it, so the implementation PR **retires it from the active specs
directory**: git-move `docs/specs/<REF>.html` to `docs/specs/archive/<REF>.html` in the same PR.
Keep the PR's `alfred` block `spec-path` pointing at the **original** active path — the
`alfred-frontmatter` check derives the archive location from it and **fails the PR if the spec is
left un-archived**. This keeps `docs/specs/` holding only specs still awaiting work, while git
history and the detail modal's sha-pinned "view in repo" link stay intact. A **skip-refinement**
task has no committed spec, so there is nothing to archive.

## A few more practices when building from a spec

False confidence creeps in here — smaller models especially plough ahead rather than pause:

- **Ground in the codebase first.** Read the patterns, types, and conventions the spec touches
  before writing: the spec describes intent, but the repo (its CLAUDE.md, lint rules,
  neighbouring code) decides how that intent is expressed, and it wins over a generic reading.
- **Ask when the spec is ambiguous or stale.** If a requirement is underspecified or has
  drifted from the code, surface it and ask — a wrong guess buried in code costs far more to
  unwind than a question up front.
- **Pin every requirement with a test**, so the spec's intent survives as executable
  back-pressure once the document is gone. (CLAUDE.md owns the TDD + demo-doc workflow.)
