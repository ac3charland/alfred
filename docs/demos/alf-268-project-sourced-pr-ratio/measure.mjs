// Drives GET /api/code/pr-ratio and GET /api/code/loc-velocity through a series of project
// sets seeded into the in-memory Supabase mock, printing only the fields that don't move with
// the clock (the week window and the weekly buckets do). Run via with-app.sh.
//
// The in-between reseeds are safe to make while the app runs: both routes read `projects` on
// every request, with no cache in between.
import { readFileSync, writeFileSync } from 'node:fs';

const { APP_URL, MOCK_URL, INGEST_API_KEY, GITHUB_STUB_LOG } = process.env;
const KEY = { 'x-api-key': INGEST_API_KEY };

function project(name, key, repoName, createdAt) {
  return { id: `p-${repoName}`, name, key, repo_owner: 'ac3charland', repo_name: repoName, created_at: createdAt };
}
const REALPLAY = project('RealPlay', 'RPL', 'realplay', '2026-01-01T00:00:00Z');
const ALFRED = project('Alfred', 'ALF', 'alfred', '2026-02-01T00:00:00Z');
const LUMEN = project('Lumen', 'LUM', 'lumen', '2026-03-01T00:00:00Z');

async function seed(projects) {
  await fetch(`${MOCK_URL}/__mock__/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projects }),
  });
  writeFileSync(GITHUB_STUB_LOG, '');
}

async function get(path, headers = KEY) {
  const response = await fetch(`${APP_URL}${path}`, { headers });
  return { status: response.status, body: await response.json() };
}

/** The ratio's clock-independent fields: the split itself, one repo per line. */
async function ratio() {
  const { status, body } = await get('/api/code/pr-ratio');
  if (status !== 200) {
    console.log(`pr-ratio     ${status}  ${JSON.stringify(body)}`);
    return;
  }
  console.log(`pr-ratio     ${status}  total ${body.total}`);
  for (const repo of body.repos) console.log(`                   ${JSON.stringify(repo)}`);
  console.log(`                   other ${JSON.stringify(body.other)}`);
}

/** The chart's clock-independent field: which repos it counted, in order. */
async function velocity() {
  const { status, body } = await get('/api/code/loc-velocity');
  console.log(`loc-velocity ${status}  ${JSON.stringify(status === 200 ? { repos: body.repos } : body)}`);
}

console.log('--- no session, no key');
await seed([REALPLAY, ALFRED]);
console.log(`pr-ratio     ${(await get('/api/code/pr-ratio', {})).status}`);
console.log(`loc-velocity ${(await get('/api/code/loc-velocity', {})).status}`);

console.log('\n--- ingest key, NO projects (PR_RATIO_REPOS is still set, and ignored)');
await seed([]);
await ratio();
await velocity();

console.log('\n--- ingest key, ONE project: a series, but not a split');
await seed([ALFRED]);
await ratio();
await velocity();

// Seeded newest-first on purpose: the answer comes back in created_at order regardless.
console.log('\n--- ingest key, three projects, seeded as [Lumen, Alfred, RealPlay]');
await seed([LUMEN, ALFRED, REALPLAY]);
await ratio();
await velocity();

// The queries run in parallel, so they reach the stub in no fixed order: list the per-repo
// searches sorted, then the Other sweep.
console.log('\n--- what GitHub was asked for that split');
const queries = readFileSync(GITHUB_STUB_LOG, 'utf8').trim().split('\n');
const repoQueries = queries
  .map((query) => /(?:^| )repo:(\S+)/.exec(query)?.[1])
  .filter((repo) => repo !== undefined)
  .toSorted();
for (const repo of repoQueries) console.log(`search repo:${repo}`);
// Print the ACTUAL logged Other query verbatim, only normalising the clock-dependent
// `merged:<start>..<end>` token — everything else (including `author:`) is the real thing,
// not a guess at its shape.
for (const query of queries.filter((q) => !/(?:^| )repo:/.test(q))) {
  console.log(`search Other: ${query.replace(/merged:\S+/, 'merged:<window>')}`);
}
