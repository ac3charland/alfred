# Reference & example libraries

Read this when the *point* of a skill is a body of reference material or worked
example scenarios too large to live in SKILL.md — API docs, per-domain schemas, a
catalog of "if the situation looks like X, do Y" scenarios, or good/bad output
samples for style calibration. None of this is new machinery: it's plain
[progressive disclosure](../SKILL.md) applied to a *library*. SKILL.md (always
loaded once the skill triggers) holds the routing logic; the bulk lives in bundled
files Claude fetches only when a task actually needs them.

## Contents

- The vocabulary: `references/` vs `examples/` vs `assets/`
- Two different things both called "examples"
- Core rules for any bundled library
- Three layouts for a scenario / example library
- The RAG boundary: when a library outgrows a skill
- Sources

## The vocabulary: `references/` vs `examples/` vs `assets/`

The canonical folder convention — used by Anthropic's skill docs, the agentskills.io
open standard, and Vercel's agent-skills guidance — is:

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions (the index)
├── scripts/          # Executable helpers Claude runs (not loaded into context)
├── references/       # Docs / scenarios loaded on demand
└── assets/           # Templates and static resources used in output
```

`references/` is the canonical home for on-demand library material. An `examples/`
folder isn't wrong — it's just not the standard term, so don't default to it. Reserve
`examples/` for the case where the bundled files are *samples that teach by
demonstration* (e.g. `examples/good-outputs.md`), and keep everything else under
`references/`. When in doubt, use `references/`; it's what a fresh agent will look for.

## Two different things both called "examples"

Don't conflate these — they get different treatment:

- **A couple of inline few-shot pairs** (two or three `Input → Output` examples that
  fit comfortably in SKILL.md). Keep them inline using the "Examples pattern" in
  SKILL.md. Loading them costs nothing extra because SKILL.md is already in context.
- **A *library* of many examples/scenarios** (a dozen worked cases, per-domain
  references, a big sample catalog). Bundle these as files and load on demand. This
  document is about that second case.

If you find an inline example list growing past three or four entries, or starting to
branch ("for cold outreach… for re-engagement… for winback…"), that's the signal to
promote it into a bundled library using one of the layouts below.

## Core rules for any bundled library

These keep a library navigable and prevent the guardrail-free failure modes (stale
duplication, half-read files):

1. **Don't duplicate content between SKILL.md and the library.** SKILL.md routes; the
   bundled file holds the content. Duplicated prose drifts out of sync and pays the
   token cost in both places.
2. **Keep references one level deep from SKILL.md.** Link every bundled file directly
   from SKILL.md — don't chain `SKILL.md → a.md → b.md`. Claude often only *partially*
   reads a file it reaches through a nested link (e.g. `head -100`), so anything behind
   a second hop may never be read in full.
3. **Give a table of contents to any reference file over ~100 lines.** A partial read
   then still reveals the file's full scope, so Claude knows what it can jump to.
4. **Put grep hints in SKILL.md for large files.** So Claude can locate the right
   section without reading the whole file. For example:
   ```bash
   grep -i "winback" references/scenarios.md
   ```
5. **Resources are free until fetched, so bundle comprehensively — but only what earns
   its place.** There's no context penalty for an unread file; the cost is the tool
   call plus the tokens *at read time*. (For scale: a skill's always-loaded metadata is
   ~55–235 tokens and a typical SKILL.md body is a couple thousand, whereas a bundled
   reference can be arbitrarily large because it loads only on demand.) Structure each
   file so a task reads as little as possible to get what it needs.

## Three layouts for a scenario / example library

Pick based on how the scenarios relate to each other, not by habit.

### Layout 1 — Scenario index (one file, named sections) — the default

```
skill-name/
├── SKILL.md                 # Lists scenario types (one line each) + grep hints
└── references/
    └── scenarios.md         # Every scenario under its own ## header
```

SKILL.md lists the scenario categories with a one-line description each and a grep
hint; `references/scenarios.md` holds the full scenarios under named `##` headers, with
a table of contents at the top. The instruction reads like: "if the situation matches
type X, read the `## X` section of `references/scenarios.md`."

**Best when** scenarios share structure but differ in content. Routing logic stays in
SKILL.md where the model can reason about it cheaply, and the whole library is one tool
call plus a grep away. Start here unless you have a reason not to.

### Layout 2 — File per scenario

```
skill-name/
├── SKILL.md
└── references/
    ├── scenario-cold-outreach.md
    ├── scenario-re-engagement.md
    └── scenario-winback.md
```

**Best when** scenarios are substantially different and loading the wrong one would be
pure noise. It's more browsable and git-diffable, but it costs a tool call per file and
spreads routing across filenames — so only split this way when the files are genuinely
independent, not just to be tidy.

### Layout 3 — Good / bad output split (calibration)

```
skill-name/
├── SKILL.md
└── examples/
    ├── good-outputs.md
    └── bad-outputs.md
```

**Best when** the examples teach a *quality bar* or a voice/style rather than a
branching workflow — exemplary outputs and anti-patterns, loaded side by side as
positive and negative few-shot. Two well-chosen files often calibrate quality better
than a large scenario catalog. Tell the skill to read both before producing output.
This is the one case where an `examples/` folder is the natural name.

**Quick chooser:** shared structure, differs in content → Layout 1. Genuinely
independent scenarios → Layout 2. Teaching a quality/voice bar → Layout 3.

## The RAG boundary: when a library outgrows a skill

There is no built-in mechanism for the model to *select among* scenarios beyond "load
the relevant file." The whole design assumes a task maps to a file (or a grep-able
section) that's small enough to load wholesale. If the library grows so large that even
the *right* slice is too big to load — i.e. you'd need semantic retrieval to pick the
relevant fragment — you're reinventing RAG inside a skill, and an MCP tool with real
retrieval is the better answer.

Signs you've crossed the line: a single scenario file in the thousands of lines, or
routing that a grep/section lookup can't express because it needs semantic search.
Below that line, a skill with bundled references is simpler and cheaper; above it, reach
for a retrieval tool.

## Sources

- [Anthropic — Skill authoring best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices) (progressive disclosure patterns, grep navigation, one-level-deep references, TOC for long files)
- [agentskills.io open standard](https://github.com/agentskills/agentskills) (`references/` / `assets/` / `scripts/` convention)
- [Vercel — Agent Skills FAQ](https://vercel.com/blog/agent-skills-explained-an-faq) (avoid SKILL.md ↔ reference duplication; grep patterns for large files)
- [soul.md](https://github.com/aaronjmars/soul.md) (good/bad output calibration pattern)
