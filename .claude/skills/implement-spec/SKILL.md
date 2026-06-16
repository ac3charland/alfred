---
name: implement-spec
description: >
  Documents alfred's house style for implementing a written spec — turning a spec,
  ticket, or design doc into code. Core rule: never carry spec-only references into the
  code, comments, commit messages, PRs, or tests — section numbers (§11, §4.6), "see the
  section above", figure/table numbers, and milestone labels are dangling pointers for
  anyone who later reads the code without the spec open; state the meaning in
  self-contained prose instead. Also covers grounding in the existing codebase before
  building, asking when the spec is ambiguous or has drifted rather than guessing, and
  pinning every requirement with a test. Read whenever you've been handed a spec and asked
  to build it. Trigger on: "implement this spec", "build the spec", "implement the ticket",
  "build specs/ALF-*.md", "the refinement spec", "implement from the design doc", or
  starting any work from a written specification.
---

# Implementing a spec

A spec is **scaffolding**: it exists to get the right code written, then the code, its
tests, and its comments outlive it. The reader you're writing for is the next agent (or
human) who opens the file a year from now — they have the code in front of them, **not the
spec**. So the implementation has to stand on its own.

## Never carry spec-only references into the code

The spec's section numbers, headings, figure/table labels, and milestone names are
coordinates into *that document*. Pasted into a comment, a commit message, a PR body, or a
test name, they become dangling pointers — the reader can't resolve `§11` without the spec
open, and the number silently rots when the spec is renumbered or retired. They read as
precise but carry no meaning to anyone downstream.

**Translate the meaning into self-contained prose instead.** If the section was saying
something worth keeping, say *that thing*; if the sentence already stands on its own, just
drop the citation.

**Example 1** — drop a citation the sentence doesn't need:
Before: `Pure builders for the Claude Code Web "open a session" deep links (§11).`
After:  `Pure builders for the Claude Code Web "open a session" deep links.`

**Example 2** — keep the meaning, lose the coordinate:
Before: `the ToS-clean human launch (§1/§11.1)`
After:  `the ToS-clean human launch — prefilled, never auto-submitted`

**Example 3** — a comment that only pointed at the spec:
Before: `// spec-path is declared on refinement PRs (§10/§12)`
After:  `// spec-path is declared on refinement PRs so the recorded path renders`

This is **not** a ban on references — it's a ban on *unresolvable* ones. A pointer to
something durable the reader can actually open is fine and often valuable: a file path
(`frontend/lib/code/links.ts`), a symbol name, an external doc with a stable title
(`PostgreSQL docs §7.8 "WITH Queries"`), or a real URL. The test is simple: **can the
reader follow it with only the repo in hand?** A bare spec section number fails that test;
a file path passes it.

## A few more practices when building from a spec

These are where false confidence creeps in — small models especially will plough ahead
rather than pause:

- **Ground in the codebase first.** Read the existing patterns, types, and conventions the
  spec will touch before writing. A spec describes intent; the repo decides how that intent
  is actually expressed here. Honor the repo's own conventions (its CLAUDE.md, lint rules,
  neighbouring code) over a generic reading of the spec.
- **Ask when the spec is ambiguous or stale — don't guess.** If a requirement is
  underspecified, or the spec has drifted from the current code, surface it and ask rather
  than inventing an answer and presenting it with false confidence. A guessed decision
  buried in code is far more expensive to unwind than a question asked up front.
- **Pin every requirement with a test.** Each behavior the spec asks for should be
  expressed in at least one test, so the spec's intent survives as executable
  back-pressure once the document is gone. (See CLAUDE.md for the TDD + demo-doc workflow —
  this skill doesn't restate it.)

The throughline: the spec is the source of truth for *what to build*; the code and its
tests are the durable record of *what was built*. Don't make the second depend on still
having the first.
