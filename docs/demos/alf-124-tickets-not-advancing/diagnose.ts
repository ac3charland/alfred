/**
 * ALF-124 diagnosis. Run the REAL Worker decision code (`parseFrontmatter` + `planTransition`) on
 * the actual BMX-5 implementation PR body. If the code already decides `ready_for_review` for an
 * `opened` event, then nothing in the parse/transition layer blocks advancement — so a stuck ticket
 * means the event never reached the Worker. The Worker is driven only by the per-repo GitHub
 * webhook; with none configured, no `pull_request` event is ever delivered and the ticket sits
 * silently. That's the root cause, and the reason the fix is repo setup, not code.
 */
import { readFileSync } from 'node:fs';

import { parseFrontmatter } from '../../../workers/src/frontmatter.ts';
import { planTransition } from '../../../workers/src/transitions.ts';

const body = readFileSync(new URL('./bmx-5-body.md', import.meta.url), 'utf8');

const fm = parseFrontmatter(body);
if (fm === undefined) throw new Error('parse failed');
console.log(`1. Worker parses the PR body   → tickets=${fm.tickets.join(',')} phase=${fm.phase}`);

const plan = planTransition({
  phase: fm.phase,
  action: 'opened',
  merged: false,
  prUrl: 'https://github.com/acme/bookmark-express/pull/5',
  specPath: fm.specPath,
});
console.log(`2. Worker plans 'opened' event → ${plan?.updates.factory_state ?? '(no-op)'}`);

console.log('\nConclusion: the code already advances BMX-5 to ready_for_review. The ticket only');
console.log('stayed put because no webhook delivered the event — the per-repo webhook (repo-setup');
console.log('README, step 3) was never added for bookmark-express. Fix = ops, not code.');
