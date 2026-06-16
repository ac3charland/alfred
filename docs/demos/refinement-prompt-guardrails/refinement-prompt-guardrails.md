---
branch: claude/refinement-prompt-agentic-review-lbcfwx
---

# Refinement & implementation prompts carry agentic guardrails

*2026-06-16T15:32:04.662Z*

The Software Factory prefills a prompt into a claude.ai/code tab when a code story is launched (frontend/lib/code/links.ts). The prompts were one-shot and optimistic: they assumed the title + notes were enough to write an implementation-ready spec, with no invitation to the human in the tab to fill gaps. A smaller model would invent scope and present it with false confidence. The builders now carry the agentic guardrails inline (not just in the maybe-absent .alfred/refinement.md guide): ground in the repo first, a clarification gate, a self-contained section skeleton for the no-guide fallback, a truncation flag on long notes, and a verbatim-block self-check.

Refinement prompt for a THIN ticket (title only, no notes). Note step 1 (ground in the repo), step 2 (ASK ME HERE before writing the spec — the clarification gate), the inline section skeleton in step 3 (so the no-guide fallback isn't an undefined "OpenSpec-style"), and the step-5 verbatim self-check.

```bash
node --experimental-strip-types --input-type=module -e "import { buildRefinementUrl } from './frontend/lib/code/links.ts'; const u = buildRefinementUrl({ repo_owner: 'ac3charland', repo_name: 'alfred' }, { ref: 'ALF-58', title: 'Add a dark-mode toggle', notes: null }); console.log(decodeURIComponent(new URL(u).searchParams.get('q')));" 2>/dev/null
```

````output
ALF-58: Add a dark-mode toggle

You are refining the alfred ticket ALF-58. Produce a SPEC ONLY — describe the concrete change in enough detail that a later session can build it, but do NOT implement anything yet (no app or source changes).

1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the spec on the code that already exists.
2. If the title and context below don't pin down the scope and acceptance criteria, ASK ME HERE before writing the spec — you don't need to guess, I'm in this tab. Otherwise go ahead.
3. Write the spec following the project's refinement guide at `.alfred/refinement.md` (a proposed convention — not yet finalized). If that file is absent, cover these sections: Title, Context/problem, Proposed change, Acceptance criteria, Out of scope / open questions. Save it to `specs/ALF-58.md`.
4. Open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly (alfred reads it to advance the ticket):

```alfred
alfred-ticket: ALF-58
phase: refinement
spec-path: specs/ALF-58.md
```

5. Before opening the PR, confirm the spec is saved at `specs/ALF-58.md` and the block above is reproduced exactly.
````

When the notes exceed the inline cap (1000 chars), the context block is flagged TRUNCATED and the agent is told the full notes live in alfred, not the repo — so partial context isn't mistaken for the whole. Here a 1500-char note is clipped; only the tail of the prompt is shown.

```bash
node --experimental-strip-types --input-type=module -e "import { buildRefinementUrl } from './frontend/lib/code/links.ts'; const u = buildRefinementUrl({ repo_owner: 'ac3charland', repo_name: 'alfred' }, { ref: 'ALF-58', title: 'Add a dark-mode toggle', notes: 'N'.repeat(1500) }); const p = decodeURIComponent(new URL(u).searchParams.get('q')); const i = p.indexOf('Context (from'); console.log(p.slice(i, i + 180) + '…');" 2>/dev/null
```

```output
Context (from the ticket — TRUNCATED; the full notes live in alfred, not this repo, so ask me here if you need the rest):
NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN…
```

The implementation prompt (launched in ready_for_dev) is no longer the thinner instruction set — it carries the same shared guardrails: ground in the repo and its conventions, the implementation analog of the clarification gate (ask when the merged spec is ambiguous or has drifted from the code), and the verbatim-block self-check before the PR.

```bash
node --experimental-strip-types --input-type=module -e "import { buildImplementationUrl } from './frontend/lib/code/links.ts'; const u = buildImplementationUrl({ repo_owner: 'ac3charland', repo_name: 'alfred' }, { ref: 'ALF-58', title: 'Add a dark-mode toggle', spec_path: 'specs/ALF-58.md', notes: null }); console.log(decodeURIComponent(new URL(u).searchParams.get('q')));" 2>/dev/null
```

````output
ALF-58: Add a dark-mode toggle

You are implementing the alfred ticket ALF-58. Implement the merged spec committed at `specs/ALF-58.md` in this repo — read it first, then build it.

Ground yourself first: skim the repo and honor its own conventions (read any CONTRIBUTING or CLAUDE.md). If the merged spec is ambiguous or has drifted from the current code, ASK ME HERE before building rather than guessing — I'm in this tab.

When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly (alfred reads it to advance the ticket):

```alfred
alfred-ticket: ALF-58
phase: implementation
spec-path: specs/ALF-58.md
```

Before opening the PR, confirm your changes satisfy the spec's acceptance criteria and the block above is reproduced exactly.
````
