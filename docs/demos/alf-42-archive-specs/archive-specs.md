---
branch: claude/exciting-archimedes-5x92zz
---

# ALF-42 — Archive specs on the implementation PR

*2026-06-24T05:23:13.802Z*

A spec is **scaffolding**: once a story is implemented, the spec has done its job. ALF-42 makes the **implementation** session retire it — git-moving `docs/specs/<REF>.html` into `docs/specs/archive/` in the same PR — and adds a CI rule (in the `alfred-frontmatter` check) that **fails an implementation PR whose spec was left un-archived**. The active `docs/specs/` directory then only ever holds specs still awaiting work.

Three pieces change: the **implementation prompt** (`frontend/lib/code/links.ts`) now tells the agent to archive; the **implement-spec skill** documents it; the **enforcing check** template gains the rule. Below proves each, end to end.

## The implementation prompt now tells the agent to archive

This calls the **actual** `buildImplementationUrl` from `frontend/lib/code/links.ts` (run via Node's TS strip-types) and prints just the archive-related lines of the decoded prompt — the agent is told to git-move the spec into `docs/specs/archive/`, while the machine-readable block keeps `spec-path` on the original active path (the check derives the archive location from it).

```bash
cd frontend && node --experimental-strip-types --input-type=module -e "
import { buildImplementationUrl } from './lib/code/links.ts';
const project = { repo_owner: 'ac3charland', repo_name: 'alfred', name: 'Alfred', key: 'ALF', id: 'p1', github_url: null, ref_seq: 5, created_at: 'x' };
const story = { ref: 'ALF-42', title: 'Archive specs on the implementation PR', spec_path: 'docs/specs/ALF-42.html', factory_state: 'ready_for_dev', notes: null };
const prompt = new URL(buildImplementationUrl(project, story)).searchParams.get('q');
for (const line of prompt.split('\n')) if (/docs\/specs\/archive|spec-path:/.test(line)) console.log(line);
" 2>/dev/null
```

```output
When the change is built, ARCHIVE the spec in this same PR: git-move `docs/specs/ALF-42.html` to `docs/specs/archive/ALF-42.html` (keep the block's spec-path below pointing at the original path). A CI check fails the PR if `docs/specs/ALF-42.html` is still sitting un-archived in the active specs directory.
spec-path: docs/specs/ALF-42.html
Before opening the PR, confirm your changes satisfy the spec's acceptance criteria, the spec is archived at `docs/specs/archive/ALF-42.html`, and the block above is reproduced exactly.
```

## Skip-refinement (bypass) prompts carry no archive step

A bypass launch — like the very session that built ALF-42 — produces **no committed spec**, so there is nothing to archive. The prompt says so explicitly, and the check passes because no file exists at the block's `spec-path`.

```bash
cd frontend && node --experimental-strip-types --input-type=module -e "
import { buildBypassUrl } from './lib/code/links.ts';
const project = { repo_owner: 'ac3charland', repo_name: 'alfred', name: 'Alfred', key: 'ALF', id: 'p1', github_url: null, ref_seq: 5, created_at: 'x' };
const story = { ref: 'ALF-50', title: 'Verify the GitHub webhook HMAC signature', spec_path: null, factory_state: 'needs_refinement', notes: null };
const prompt = new URL(buildBypassUrl(project, story)).searchParams.get('q');
console.log('bypass prompt mentions archiving a spec:', /archive/i.test(prompt));
" 2>/dev/null
```

```output
bypass prompt mentions archiving a spec: false
```

## The enforcing check fails an un-archived implementation PR

This runs the **archive rule from the `alfred-frontmatter` check** (mirrored verbatim from `docs/code-module/repo-setup/alfred-frontmatter.yml`) against three PRs, each over a throwaway repo tree. The implementation PR that left its spec in the active directory **fails**; archiving it (or a bypass PR with no spec at all) **passes**.

````bash
set -e
work=$(mktemp -d); cd "$work"; mkdir -p docs/specs/archive
cat > check.js <<'JS'
const fs = require('fs');
const b = process.env.BODY || '';
const m = b.match(/```alfred\s+([\s\S]*?)```/);
if (!m) { console.error('missing alfred block'); process.exit(1); }
const blk = m[1];
const ticket = /alfred-ticket:\s*(.+)/.exec(blk);
const phase  = /phase:\s*(refinement|implementation)/.exec(blk);
if (!ticket || !phase) { console.error('need alfred-ticket + phase'); process.exit(1); }
const specPath = (/spec-path:\s*(\S+)/.exec(blk) || [])[1];
if (phase[1] === 'refinement' && !specPath) { console.error('refinement PRs need spec-path'); process.exit(1); }
if (phase[1] === 'implementation' && specPath && specPath.startsWith('docs/specs/') && !specPath.startsWith('docs/specs/archive/') && fs.existsSync(specPath)) {
  console.error('implementation PR must archive its spec: git-move ' + specPath + ' to docs/specs/archive/' + specPath.split('/').pop());
  process.exit(1);
}
console.log('ok:', ticket[1].trim(), phase[1]);
JS
BLOCK='```alfred
alfred-ticket: ALF-42
phase: implementation
spec-path: docs/specs/ALF-42.html
```'
run() { printf '%-46s' "$1"; if BODY="$2" node check.js >/tmp/o 2>&1; then echo "PASS  -> $(cat /tmp/o)"; else echo "FAIL  -> $(cat /tmp/o)"; fi; }
: > docs/specs/ALF-42.html
run 'implementation, spec left in active dir:' "$BLOCK"
rm docs/specs/ALF-42.html; : > docs/specs/archive/ALF-42.html
run 'implementation, spec archived:' "$BLOCK"
rm docs/specs/archive/ALF-42.html
run 'bypass (no committed spec):' "$BLOCK"
cd /; rm -rf "$work"
````

```output
implementation, spec left in active dir:      FAIL  -> implementation PR must archive its spec: git-move docs/specs/ALF-42.html to docs/specs/archive/ALF-42.html
implementation, spec archived:                PASS  -> ok: ALF-42 implementation
bypass (no committed spec):                   PASS  -> ok: ALF-42 implementation
```
