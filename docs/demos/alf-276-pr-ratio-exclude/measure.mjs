// Drives the PR-ratio exclusion end to end through the real routes: PATCH /api/projects/:id sets
// the flag, GET /api/code/pr-ratio and GET /api/code/loc-velocity read it back. Prints only the
// fields that don't move with the clock (the week window and the weekly buckets do). Run via
// with-app.sh.
//
// The PATCH needs a browser session, so a session cookie is minted by `@supabase/ssr` itself
// signing in against the mock — the same client the app uses. The GETs use the ingest API key,
// as the weekly-review skill does.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { createServerClient } from '@supabase/ssr';

const { APP_URL, MOCK_URL, INGEST_API_KEY, GITHUB_STUB_LOG } = process.env;
const KEY = { 'x-api-key': INGEST_API_KEY };

const jar = new Map();
const auth = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  },
);
const { error: signInError } = await auth.auth.signInWithPassword({
  email: 'demo@alfred.test',
  password: 'demo-password-123',
});
if (signInError) throw signInError;
const COOKIE = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

function project(id, name, key, repoName, createdAt, excluded = false) {
  return {
    id,
    name,
    key,
    repo_owner: 'ac3charland',
    repo_name: repoName,
    created_at: createdAt,
    exclude_from_pr_ratio: excluded,
  };
}
// Real UUIDs: the PATCH route validates the id.
const ALFRED = project('00000000-0000-4000-8000-0000000000a1', 'Alfred', 'ALF', 'alfred', '2026-01-01T00:00:00Z');
const REALPLAY = project('00000000-0000-4000-8000-0000000000a2', 'RealPlay', 'RPL', 'realplay', '2026-02-01T00:00:00Z');
const KNOWLEDGE = project('00000000-0000-4000-8000-0000000000a3', 'Knowledge', 'KNO', 'knowledge', '2026-03-01T00:00:00Z');

async function seed(projects) {
  await fetch(`${MOCK_URL}/__mock__/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projects }),
  });
}

async function patchProject(target, body) {
  const response = await fetch(`${APP_URL}/api/projects/${target.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  const shown = response.ok ? { name: json.name, exclude_from_pr_ratio: json.exclude_from_pr_ratio } : json;
  console.log(`PATCH ${target.name} ${JSON.stringify(body)}  →  ${response.status} ${JSON.stringify(shown)}`);
}

async function get(path) {
  const response = await fetch(`${APP_URL}${path}`, { headers: KEY });
  return { status: response.status, body: await response.json() };
}

/** The ratio's clock-independent fields: the split itself, one repo per line. */
async function ratio() {
  writeFileSync(GITHUB_STUB_LOG, '');
  const { status, body } = await get('/api/code/pr-ratio');
  if (status !== 200) {
    console.log(`pr-ratio     ${status}  ${JSON.stringify(body)}`);
    return;
  }
  console.log(`pr-ratio     ${status}  total ${body.total}`);
  for (const repo of body.repos) console.log(`                   ${JSON.stringify(repo)}`);
  if (body.repos.length === 0) console.log('                   repos []');
  console.log(`                   other ${JSON.stringify(body.other)}`);
}

/** The chart's clock-independent field: which repos it counted, in order. */
async function velocity() {
  const { status, body } = await get('/api/code/loc-velocity');
  console.log(`loc-velocity ${status}  ${JSON.stringify(status === 200 ? { repos: body.repos } : body)}`);
}

/**
 * What GitHub was asked for the last ratio. The queries run in parallel, so they reach the stub in
 * no fixed order: the per-repo searches sorted, then the Other sweep verbatim (only the
 * clock-dependent `merged:` window normalised).
 */
function searches() {
  const queries = readFileSync(GITHUB_STUB_LOG, 'utf8').trim().split('\n').filter(Boolean);
  const repoQueries = queries
    .map((query) => /(?:^| )repo:(\S+)/.exec(query)?.[1])
    .filter((repo) => repo !== undefined)
    .toSorted();
  for (const repo of repoQueries) console.log(`search repo:${repo}`);
  for (const query of queries.filter((q) => !/(?:^| )repo:/.test(q))) {
    console.log(`search Other: ${query.replace(/merged:\S+/, 'merged:<window>')}`);
  }
}

console.log('--- three projects; the owner ticks Knowledge in the card’s ⋯ menu');
await seed([ALFRED, REALPLAY, KNOWLEDGE]);
await patchProject(KNOWLEDGE, { exclude_from_pr_ratio: true });
await ratio();

console.log('\n--- what GitHub was asked for that split: nothing about knowledge, except to subtract it from Other');
searches();

console.log('\n--- the lines-changed chart still measures Knowledge');
await velocity();

console.log('\n--- a non-boolean flag is refused');
await patchProject(KNOWLEDGE, { exclude_from_pr_ratio: 'yes' });

console.log('\n--- unticked again: Knowledge is back in the split');
await patchProject(KNOWLEDGE, { exclude_from_pr_ratio: false });
await ratio();

console.log('\n--- every project ticked: no repos, only what Other counts (the card shows its muted line instead)');
await patchProject(ALFRED, { exclude_from_pr_ratio: true });
await patchProject(REALPLAY, { exclude_from_pr_ratio: true });
await patchProject(KNOWLEDGE, { exclude_from_pr_ratio: true });
await ratio();

console.log('\n--- two projects, one excluded: still configured (never a 501), a one-project split');
await seed([ALFRED, { ...KNOWLEDGE, exclude_from_pr_ratio: true }]);
await ratio();
