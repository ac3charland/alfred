// Demo helper: exercises the REAL branch-folder rule so the demo doc shows the
// docs-only exception actually firing (and not firing). Run from the repo root:
//   node docs/demos/demo-lint-docs-exception/check-exception.mjs
import process from 'node:process';

import { gatherDemos } from '../../../tools/demo-lint/src/demos.ts';
import { rules } from '../../../tools/demo-lint/src/rules.ts';

const branchFolder = rules.find((rule) => rule.name === 'branch-folder');

// Run the rule for a feature branch that owns no demo, given a set of changed
// paths. The only variable that matters here is whether anything changed outside
// docs/ — the branch is undeclared and has no folder, so without the exception the
// rule always fires.
function findings(changedPaths) {
  const demos = gatherDemos('docs/demos', process.cwd(), 'claude/example-feature', changedPaths);
  return branchFolder.check(demos).map((finding) => finding.rule);
}

console.log('only docs/ changed   ->', JSON.stringify(findings(['docs/code-module-spec.md'])));
console.log('a non-docs change    ->', JSON.stringify(findings(['frontend/app/page.tsx'])));
console.log('docs + a tool change ->', JSON.stringify(findings(['docs/x.md', 'tools/demo-lint/src/rules.ts'])));
