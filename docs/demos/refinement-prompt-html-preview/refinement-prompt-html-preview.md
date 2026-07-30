---
branch: claude/refinement-prompt-github-preview-j83edz
---

# The refinement launch prompts carry the HTML spec link

*2026-07-30T15:33:58.080Z*

ALF-142. The htmlpreview.github.io preview-link instruction lived in the refinement skill — a file that is copy-pasted into every project repo, so each repo owned its own copy to keep in sync. It now lives once in the launch prompts alfred builds (frontend/lib/code/links.ts), which reach every project regardless of what its skill file says. The two skill files simply lost the paragraph.

Step 5 is the instruction. It covers both cases: htmlpreview renders the spec on a public repo, but it fetches through raw.githubusercontent.com unauthenticated and so 404s on a private one — there the prompt asks for a direct link to the file instead, to download and open. The repo is baked into both URLs from the project row; only the head branch and spec path are left for the agent, since only it knows where the spec landed. Built here for a project other than alfred so the interpolated repo is visible:

```bash
node --experimental-strip-types --input-type=module -e "
import { buildRefinementUrl } from './frontend/lib/code/links.ts';
const u = buildRefinementUrl(
  { repo_owner: 'octocat', repo_name: 'relay' },
  { ref: 'RLP-7', title: 'Add the digest scheduler', notes: null, epic_spec_path: null },
);
console.log(decodeURIComponent(new URL(u).searchParams.get('q')));
" 2>/dev/null
```

````output
RLP-7: Add the digest scheduler

You are refining the ticket RLP-7. Produce a SPEC ONLY — describe the concrete change in enough detail that a later session can build it, but do NOT implement anything yet (no app or source changes).

1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the spec on the code that already exists.
2. If the title and context below don't pin down the scope and acceptance criteria, ASK ME HERE before writing the spec — you don't need to guess, I'm in this tab. Otherwise go ahead.
3. Write the spec following the refinement skill at `.claude/skills/refinement/SKILL.md` (it auto-loads in a refinement session) — it defines this repo's spec format, structure, and where the spec lives. If the skill is absent, write the spec as a single self-contained HTML document and save it under the repo's specs directory.
4. Open a pull request whose description carries this machine-readable block — the orchestrator (alfred) reads it to advance the ticket and a CI check enforces it. Reproduce the `alfred-ticket` and `phase` lines exactly, and set `spec-path` to where you saved the spec (a file, or the folder for a multi-file spec):

```alfred
alfred-ticket: RLP-7
phase: refinement
spec-path: <path-or-folder-of-the-spec>
```

5. If the spec is an HTML file, also link it in the description so a reviewer can read the plan rather than the markup — GitHub serves a committed `.html` as raw source. On a public repo, route it through htmlpreview: `https://htmlpreview.github.io/?https://github.com/octocat/relay/blob/<head-branch>/<spec-path>`. htmlpreview can't reach a private repo — if this one is private, link the file directly instead (`https://github.com/octocat/relay/blob/<head-branch>/<spec-path>`) so the reviewer can download and open it. Either way point at this PR's head branch; the spec isn't on main yet.
6. Before opening the PR, confirm the spec is saved, `spec-path` above names that spec (not the placeholder), the preview link is there if the spec is HTML, and the block is reproduced exactly.
````

An epic spec is HTML too, so the epic-refinement prompt carries the same step (tail of the prompt shown):

```bash
node --experimental-strip-types --input-type=module -e "
import { buildEpicRefinementUrl } from './frontend/lib/code/links.ts';
const u = buildEpicRefinementUrl(
  { repo_owner: 'octocat', repo_name: 'relay' },
  { ref: 'RLP-3', name: 'Digest pipeline', notes: null, spec_path: null },
);
const p = decodeURIComponent(new URL(u).searchParams.get('q'));
console.log(p.slice(p.indexOf('5. ')));
" 2>/dev/null
```

```output
5. If the spec is an HTML file, also link it in the description so a reviewer can read the plan rather than the markup — GitHub serves a committed `.html` as raw source. On a public repo, route it through htmlpreview: `https://htmlpreview.github.io/?https://github.com/octocat/relay/blob/<head-branch>/<spec-path>`. htmlpreview can't reach a private repo — if this one is private, link the file directly instead (`https://github.com/octocat/relay/blob/<head-branch>/<spec-path>`) so the reviewer can download and open it. Either way point at this PR's head branch; the spec isn't on main yet.
6. Before opening the PR, confirm the spec is saved, `spec-path` above names that spec (not the placeholder), the preview link is there if the spec is HTML, and the block is reproduced exactly.
```

The instruction is gone from the two skill files that get copied into each repo, and lives only in the prompt builder — one source, no per-repo copies to drift:

```bash
for f in .claude/skills/refinement/SKILL.md .claude/skills/epic-refinement/SKILL.md frontend/lib/code/links.ts; do echo "$f: $(grep -c htmlpreview "$f") mention(s)"; done
```

```output
.claude/skills/refinement/SKILL.md: 0 mention(s)
.claude/skills/epic-refinement/SKILL.md: 0 mention(s)
frontend/lib/code/links.ts: 3 mention(s)
```
