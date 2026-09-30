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

## The workflow

False confidence creeps in here — smaller models especially plough ahead rather than pause — so
work these steps in order:

1. **Ground in the codebase.** Read the spec, then the patterns, types, and conventions it
   touches: the spec describes intent, but the repo (its CLAUDE.md, lint rules, neighbouring
   code) decides how that intent is expressed, and it wins over a generic reading.
2. **Ask when the spec is ambiguous or stale.** If a requirement is underspecified or has
   drifted from the code, surface it and ask — a wrong guess buried in code costs far more to
   unwind than a question up front.
3. **Build it test-first, pinning every requirement with a test**, so the spec's intent survives
   as executable back-pressure once the document is gone. (CLAUDE.md owns the TDD + demo-doc
   workflow.)
4. **Archive the spec and open the PR** with its `alfred` block (see below).
5. **Dispatch the adversarial reviewer.** Spawn a subagent with its model set to Opus — the Agent
   tool's `model: "opus"`, whatever model you are — briefed per the adversarial-review skill's
   checklist — it owns what the brief holds, the demo doc among them — but not your reasoning.
   Tell it to report only. Run it in the foreground and wait for its report —
   that wait is your own work, not a check-in.
6. **Repair.** Verify each finding against the code. Fix the in-scope legitimate ones test-first,
   raise real out-of-scope ones with the human, and decline the rest only with evidence. Push
   through the normal gates.
7. **Record the round.** Add an *Adversarial review* section to the PR description — every
   finding with its disposition — leaving the `alfred` block intact.

One review round unless the ticket context says otherwise. Past that, don't proactively schedule
a check-in on the PR (CLAUDE.md's "No scheduled check-ins" rule): respond to CI failures or
comments that reach you, but don't poll for them on a timer.

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
