// The root cause, read off the two real revisions of the parser.
//
// PR 247 carried a valid `alfred` block, yet GitHub's Recent Deliveries recorded
// `200 {"ignored":"no alfred frontmatter block"}`. Run PR 247's actual block through the parser
// as it stood BEFORE ALF-130 (what Cloudflare was still serving) and as it stands on main today.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENV, PR_247_BODY, REPO_ROOT, sign, workerModule } from './worker-harness.mjs';

// `5ac0478` is "feat(worker): route the epic-refinement phase at the epics table" — the commit
// that taught the Worker this phase. Its parent is the build production was still running.
const oldSource = execFileSync('git', ['show', '5ac0478~1:workers/src/frontmatter.ts'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
const newSource = readFileSync(join(REPO_ROOT, 'workers/src/frontmatter.ts'), 'utf8');

const oldPath = join(mkdtempSync(join(tmpdir(), 'alf149-')), 'frontmatter.ts');
writeFileSync(oldPath, oldSource);

const deployed = await import(oldPath);
const merged = await import(join(REPO_ROOT, 'workers/src/frontmatter.ts'));

const phaseRe = (text) => /const PHASE_RE = .*/.exec(text)?.[0] ?? '(not found)';
console.log('deployed (pre-ALF-130) :', phaseRe(oldSource));
console.log('merged   (on main)     :', phaseRe(newSource));
console.log();
console.log('PR 247 declares `phase: epic-refinement`. The old alternation has no branch that can');
console.log('match it, so the phase reads undefined and the entire block is treated as absent:');
console.log();
console.log('  deployed parser →', JSON.stringify(deployed.parseFrontmatter(PR_247_BODY)));
console.log('  merged   parser →', JSON.stringify(merged.parseFrontmatter(PR_247_BODY)));
console.log();

// A block that fails to parse and a PR with no block at all take the SAME branch in the handler,
// so this is the response PR 247's merge received — a 200, which reads as a healthy delivery.
const payload = JSON.stringify({
  action: 'closed',
  pull_request: {
    body: 'a pull request with no alfred block',
    html_url: 'https://github.com/ac3charland/alfred/pull/247',
    merged: true,
    merge_commit_sha: '832fe360e52a9075bf0aa13aa2abdb0568209846',
  },
  repository: { full_name: 'ac3charland/alfred' },
});
const response = await workerModule.handleWebhook(
  new Request('https://worker.dev/github/webhook', {
    method: 'POST',
    body: payload,
    headers: {
      'X-GitHub-Event': 'pull_request',
      'X-Hub-Signature-256': await sign(ENV.GITHUB_WEBHOOK_SECRET, payload),
    },
  }),
  ENV,
  { waitUntil: () => {} },
);
console.log(`the reply GitHub logged → ${String(response.status)} ${await response.text()}`);
