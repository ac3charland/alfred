---
branch: claude/alf-60-refinement-skill-dpokeq
---

# Refinement conventions live in the skill, not the launch prompt

*2026-06-25T17:48:13.200Z*

ALF-60 moves the bulk of the refinement spec conventions out of the prefilled claude.ai/code launch prompt (frontend/lib/code/links.ts) and into the per-project refinement skill. The prompt keeps only what every project shares: identify the ticket, point at the skill, the agentic guardrails (ground/ask/self-check), and the one machine-readable hook into alfred — the `alfred` block. HOW the spec is shaped and WHERE it lives are now the skill's job, so each project can use its own conventions (a single HTML plan here, an OpenSpec change folder elsewhere).

The full refinement prompt is now thin. It points at the refinement skill for the spec's format/structure/location, and the `alfred` block's `spec-path` is a fill-in placeholder the agent replaces with wherever it actually saved the spec — a single file, or a folder for a multi-file (OpenSpec-style) spec.

```bash
node --experimental-strip-types --input-type=module -e "import { buildRefinementUrl } from './frontend/lib/code/links.ts'; const u = buildRefinementUrl({ repo_owner: 'ac3charland', repo_name: 'alfred' }, { ref: 'ALF-58', title: 'Add a dark-mode toggle', notes: null }); console.log(decodeURIComponent(new URL(u).searchParams.get('q')));" 2>/dev/null
```

````output
ALF-58: Add a dark-mode toggle

You are refining the ticket ALF-58. Produce a SPEC ONLY — describe the concrete change in enough detail that a later session can build it, but do NOT implement anything yet (no app or source changes).

1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the spec on the code that already exists.
2. If the title and context below don't pin down the scope and acceptance criteria, ASK ME HERE before writing the spec — you don't need to guess, I'm in this tab. Otherwise go ahead.
3. Write the spec following the refinement skill at `.claude/skills/refinement/SKILL.md` (it auto-loads in a refinement session) — it defines this repo's spec format, structure, and where the spec lives. If the skill is absent, write the spec as a single self-contained HTML document and save it under the repo's specs directory.
4. Open a pull request whose description carries this machine-readable block — alfred reads it to advance the ticket and a CI check enforces it. Reproduce the `alfred-ticket` and `phase` lines exactly, and set `spec-path` to where you saved the spec (a file, or the folder for a multi-file spec):

```alfred
alfred-ticket: ALF-58
phase: refinement
spec-path: <path-or-folder-of-the-spec>
```

5. Before opening the PR, confirm the spec is saved, `spec-path` above names that spec (not the placeholder), and the block is reproduced exactly.
````

The key win: the prompt no longer bakes a spec path or format. An OpenSpec project whose specs are multi-file folders is no longer forced into a single `docs/specs/<REF>.html`. This check confirms the prompt carries the fill-in placeholder and NOT a hardcoded .html path.

```bash
node --experimental-strip-types --input-type=module -e "import { buildRefinementUrl } from './frontend/lib/code/links.ts'; const q = decodeURIComponent(new URL(buildRefinementUrl({ repo_owner: 'me', repo_name: 'relay' }, { ref: 'RLP-7', title: 'Add the digest scheduler', notes: null })).searchParams.get('q')); console.log('hardcodes docs/specs/RLP-7.html :', q.includes('docs/specs/RLP-7.html')); console.log('carries fill-in placeholder   :', q.includes('spec-path: <path-or-folder-of-the-spec>')); console.log('points at refinement skill    :', q.includes('.claude/skills/refinement/SKILL.md'));" 2>/dev/null
```

```output
hardcodes docs/specs/RLP-7.html : false
carries fill-in placeholder   : true
points at refinement skill    : true
```

Symmetrically, the implementation and bypass prompts shed their format assumptions too. The implementation prompt no longer says "it's a self-contained HTML plan, so open it in a browser" — it reads the spec format-agnostically (HTML, markdown, or a folder) and points at the implement-spec skill for the build conventions, while keeping the CI-enforced archive step inline as the system hook.

```bash
node --experimental-strip-types --input-type=module -e "import { buildImplementationUrl, buildBypassUrl } from './frontend/lib/code/links.ts'; const q = (u) => decodeURIComponent(new URL(u).searchParams.get('q')); const impl = q(buildImplementationUrl({ repo_owner: 'ac3charland', repo_name: 'alfred' }, { ref: 'ALF-58', title: 'Add a dark-mode toggle', spec_path: 'docs/specs/ALF-58.html', notes: null })); const bypass = q(buildBypassUrl({ repo_owner: 'ac3charland', repo_name: 'alfred' }, { ref: 'ALF-58', title: 'Add a dark-mode toggle', spec_path: null, notes: null })); console.log('impl assumes HTML/open-in-browser :', /self-contained HTML plan|open it in a browser/i.test(impl)); console.log('impl points at implement-spec     :', impl.includes('.claude/skills/implement-spec/SKILL.md')); console.log('impl keeps the archive hook       :', impl.includes('ARCHIVE the spec')); console.log('bypass points at implement-spec   :', bypass.includes('.claude/skills/implement-spec/SKILL.md'));" 2>/dev/null
```

```output
impl assumes HTML/open-in-browser : false
impl points at implement-spec     : true
impl keeps the archive hook       : true
bypass points at implement-spec   : true
```
