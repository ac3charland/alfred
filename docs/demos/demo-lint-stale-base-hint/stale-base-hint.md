---
branch: claude/demo-lint-stale-base-hint
---

# demo-lint: stale-base rebase hint on branch-folder

*2026-07-01T04:24:50.874Z*

When a feature branch is behind trunk, demo-lint's changed-since-trunk diff picks up trunk's own intervening (non-docs) commits. A genuinely docs-only branch then reads as `hasChangesOutsideDocs`, so the `branch-folder` rule fires and demands a demo it doesn't actually owe — a confusing false positive that cost real rediscovery time. This change teaches the error to detect the stale base (via a new `staleBaseTrunkRef` fact) and spell out the rebase fix inline.

Below, we call the pure `lintDemos` with a crafted context twice — once with an up-to-date base, once behind `origin/main` — and print the `branch-folder` message each time. Only the stale-base run carries the NOTE with the rebase steps.

```bash
node --input-type=module --eval '
import { lintDemos } from "./tools/demo-lint/src/lint.ts";
const base = {
  demosDir: "/repo/docs/demos", displayPath: "docs/demos", rootFiles: ["README.md"],
  branch: "claude/foo", branchFolder: "claude/foo", branchFolderHasContent: false,
  declaredBranches: [], demoContents: [], hasChangesOutsideDocs: true,
};
const msg = (ctx) => lintDemos(ctx).find((f) => f.rule === "branch-folder").message;
console.log("-- up-to-date base --");
console.log(msg({ ...base, staleBaseTrunkRef: undefined }));
console.log();
console.log("-- stale base (behind origin/main) --");
console.log(msg({ ...base, staleBaseTrunkRef: "origin/main" }));
'
```

```output
-- up-to-date base --
branch "claude/foo" has no demo. Capture it in its own folder under docs/demos/ — npm run demo -- init docs/demos/<feature-name>/<name>.md "<title>" records this branch in the doc's front matter automatically.

-- stale base (behind origin/main) --
branch "claude/foo" has no demo. Capture it in its own folder under docs/demos/ — npm run demo -- init docs/demos/<feature-name>/<name>.md "<title>" records this branch in the doc's front matter automatically. NOTE: this branch is behind origin/main, so the changed-file set includes intervening commits from trunk — if this is really a docs-only branch, that stale base is why the exemption didn't apply. Rebase onto current trunk (git fetch origin && git rebase origin/main) so the diff is docs-only, then re-run.
```
