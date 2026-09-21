---
branch: claude/alf-164-core-prompt-archive-j3aj9r
---

# Implementation prompt defers spec-archiving to the skill

*2026-09-21T03:36:41.843Z*

ALF-164 moves the spec-archiving convention out of the prefilled claude.ai/code implementation prompt (frontend/lib/code/links.ts) and defers it to the implement-spec skill — the same pattern ALF-60 already used for the spec's format/location. The prompt no longer mandates a git-move to docs/specs/archive/ unconditionally; it says to follow the implement-spec skill's own archiving convention, and only falls back to docs/specs/archive/ when that skill is absent from the repo. The one thing that stays hardcoded is the CI-enforced hook every project needs regardless of convention: the recorded spec-path must no longer resolve to a file once the PR lands.

```bash
node --experimental-strip-types --input-type=module -e "
import { buildImplementationUrl } from './frontend/lib/code/links.ts';
const u = buildImplementationUrl(
  { repo_owner: 'ac3charland', repo_name: 'alfred' },
  { ref: 'ALF-42', title: 'Verify the GitHub webhook HMAC signature', spec_path: 'docs/specs/ALF-42.html', notes: null, epic_spec_path: null }
);
console.log(decodeURIComponent(new URL(u).searchParams.get('q')));
" 2>/dev/null
```

````output
ALF-42: Verify the GitHub webhook HMAC signature

You are implementing the ticket ALF-42. Implement the merged spec committed at `docs/specs/ALF-42.html` in this repo — read it first, then build it.

Ground yourself first: skim the repo and honor its own conventions (read any CONTRIBUTING or CLAUDE.md). If the merged spec is ambiguous or has drifted from the current code, ASK ME HERE before building rather than guessing — I'm in this tab. Follow the implement-spec skill at `.claude/skills/implement-spec/SKILL.md` where present — it owns the conventions for building from a spec, including how and where the consumed spec gets archived, and pinning each requirement with a test.

When the change is built, ARCHIVE the now-consumed spec in this same PR (keep the block's spec-path below pointing at the original path `docs/specs/ALF-42.html`). If the implement-spec skill is absent, git-move it to `docs/specs/archive/ALF-42.html`. A CI check fails the PR if `docs/specs/ALF-42.html` is still sitting un-archived in the active specs directory.

When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly:

```alfred
alfred-ticket: ALF-42
phase: implementation
spec-path: docs/specs/ALF-42.html
```

Before opening the PR, confirm your changes satisfy the spec's acceptance criteria, the spec has been archived out of the active specs directory, and the block above is reproduced exactly.
Once this PR is open, don't proactively schedule a check-in on it (a wakeup, timer, or recurring job polling it, its CI, or its deploy) — left running that's tokens spent finding nothing new. Do respond when a CI failure or comment actually reaches you, via an event subscription (e.g. subscribe_pr_activity) rather than a timer. (Pacing your own work before this PR exists — waiting out a slow check, say — is unaffected and fine.)
````

The prompt still names docs/specs/archive/ so a repo with no implement-spec skill has a working default, but only after the "if the skill is absent" qualifier — the skill is what a project actually follows. This check confirms both: the fallback text is conditioned on the skill's absence, and the unconditional "ARCHIVE the spec: git-move X to Y" mandate ALF-60 left in place is gone.

```bash
cat > ./alf164-check.mjs <<'JSEOF'
import { buildImplementationUrl } from './frontend/lib/code/links.ts';

const q = decodeURIComponent(
  new URL(
    buildImplementationUrl(
      { repo_owner: 'me', repo_name: 'relay' },
      {
        ref: 'RLP-7',
        title: 'Add the digest scheduler',
        spec_path: 'docs/specs/RLP-7.md',
        notes: null,
        epic_spec_path: null,
      },
    ),
  ).searchParams.get('q'),
);

console.log('mandates git-move unconditionally   :', /ARCHIVE the spec in this same PR: git-move/.test(q));
console.log('defers archiving to the skill       :', /implement-spec skill.*how and where the consumed spec gets archived/.test(q));
console.log('fallback gated on skill absence     :', q.includes("If the implement-spec skill is absent, git-move it to"));
console.log('fallback path derives from basename :', q.includes("docs/specs/archive/RLP-7.md"));
console.log('CI hook keeps the original spec-path:', q.includes("`docs/specs/RLP-7.md` is still sitting un-archived"));
JSEOF
node --experimental-strip-types ./alf164-check.mjs 2>/dev/null
rm -f ./alf164-check.mjs
```

```output
mandates git-move unconditionally   : false
defers archiving to the skill       : true
fallback gated on skill absence     : true
fallback path derives from basename : true
CI hook keeps the original spec-path: true
```
