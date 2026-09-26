#!/usr/bin/env node
/**
 * The Worker's wiki sync on a stubbed run: the REAL `syncWiki` out of `workers/src/wiki/sync.ts`
 * (bundled straight from source by esbuild, imported unmodified) handed a `fetch` that plays
 * GitHub's GraphQL API and Supabase's PostgREST in memory. It prints the `wiki_pages` and
 * `wiki_sync` rows before and after a run, and every subrequest the run made.
 *
 *   node docs/demos/alf-261-day-2-wiki/wiki-sync-harness.mjs <section>
 *
 *   first    an empty snapshot meets a repo with three pages
 *   push     the next push edits one page, deletes one, adds one (with broken YAML)
 *   failed   GitHub answers the tree query with a GraphQL error: nothing is touched
 *
 * REAL: the sync's diff, both GraphQL queries and their strict readers, the page parser (the
 * `yaml` frontmatter, the link scan), the row shapes, the upsert/delete/state requests and their
 * ordering. STOOD UP LOCALLY: GitHub (a path → text map; blob oids are real git blob hashes of
 * the text) and PostgREST (a path-keyed table honouring `on_conflict` merge and `in.(…)` delete).
 * `now` is pinned, so every stamp is a literal.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = mkdtempSync(path.join(tmpdir(), 'wiki-sync-'));
await build({
  entryPoints: [path.join(ROOT, 'workers/src/wiki/sync.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(out, 'sync.mjs'),
  // `yaml`'s CommonJS build requires `process`; give the ESM bundle a real `require` for builtins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'silent',
});
const { syncWiki, WIKI_SYNC_SUBREQUEST_CEILING } = await import(
  pathToFileURL(path.join(out, 'sync.mjs')).href
);
rmSync(out, { recursive: true, force: true });

const env = {
  GITHUB_TOKEN: 'github_pat_demo',
  WIKI_REPO: 'ac3charland/knowledge',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

/** A git blob oid — what GitHub would report for this text. */
const blobOid = (text) =>
  createHash('sha1').update(`blob ${String(Buffer.byteLength(text))}\0${text}`).digest('hex');
const short = (oid) => (oid === null || oid === undefined ? '—' : oid.slice(0, 7));

// ── The repo ────────────────────────────────────────────────────────────────
const page = (title, updated, body) => `---\ntitle: ${title}\nupdated: ${updated}\n---\n${body}\n`;
const COMMIT_1 = '1'.repeat(40);
const COMMIT_2 = '2'.repeat(40);
const REPO_1 = {
  'wiki/concepts/habit-stacking.md': page(
    'Habit stacking',
    '2026-09-20',
    'Anchor a new habit to [one you already do](habit-loop.md). Coined by [James Clear](../entities/james-clear.md).',
  ),
  'wiki/concepts/habit-loop.md': page('Habit loop', '2026-09-18', 'Cue, routine, reward.'),
  'wiki/entities/james-clear.md': page('James Clear', '2026-09-18', 'Wrote Atomic Habits.'),
};
const REPO_2 = {
  // edited
  'wiki/concepts/habit-stacking.md': page(
    'Habit stacking',
    '2026-09-25',
    'Anchor a new habit to [one you already do](habit-loop.md), then [track it](../questions/do-streaks-help.md).',
  ),
  // unchanged
  'wiki/concepts/habit-loop.md': REPO_1['wiki/concepts/habit-loop.md'],
  // james-clear.md deleted; a question added — with a YAML block that does not parse
  'wiki/questions/do-streaks-help.md': '---\ntitle: [Do streaks help\n---\nOnly until the first miss.\n',
};

// ── The stand-in backend ────────────────────────────────────────────────────
function backend({ repo, commit, table = new Map(), sync = {}, treeError }) {
  const calls = [];
  const byOid = new Map(Object.values(repo).map((text) => [blobOid(text), text]));
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

  const fetch = async (url, init) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const u = new URL(url);

    if (u.hostname === 'api.github.com') {
      const isTree = body.query.includes('refs/heads/main');
      calls.push(`POST   graphql  #${isTree ? '1 tree + commit' : `2 blobs ×${String(body.query.match(/object\(oid:/g).length)}`}`);
      if (isTree && treeError !== undefined) return json({ data: null, errors: [{ message: treeError }] });
      if (isTree) {
        const sections = { concepts: [], entities: [], sources: [], questions: [] };
        for (const [p, text] of Object.entries(repo)) {
          const [, section, name] = p.split('/');
          sections[section].push({ name, type: 'blob', oid: blobOid(text) });
        }
        const repository = { ref: { target: { oid: commit } } };
        for (const [section, entries] of Object.entries(sections)) {
          repository[section] = entries.length === 0 ? null : { entries };
        }
        return json({ data: { repository } });
      }
      const repository = {};
      for (const [, alias, oid] of body.query.matchAll(/(p\d+): object\(oid: "([\da-f]+)"\)/g)) {
        repository[alias] = { text: byOid.get(oid), isBinary: false, isTruncated: false };
      }
      return json({ data: { repository } });
    }

    const tableName = u.pathname.replace('/rest/v1/', '');
    const q = Object.fromEntries(u.searchParams);
    calls.push(`${method.padEnd(7)}${tableName}${method === 'DELETE' ? ` ${q.path}` : ''}`);
    if (tableName === 'wiki_pages' && method === 'GET') {
      return json([...table.values()].map(({ path: p, blob_oid }) => ({ path: p, blob_oid })));
    }
    if (tableName === 'wiki_pages' && method === 'POST') {
      for (const row of body) table.set(row.path, { ...table.get(row.path), ...row });
      return new Response(undefined, { status: 201 });
    }
    if (tableName === 'wiki_pages' && method === 'DELETE') {
      for (const [, p] of q.path.matchAll(/"((?:[^"\\]|\\.)*)"/g)) table.delete(p);
      return new Response(undefined, { status: 204 });
    }
    if (tableName === 'wiki_sync' && method === 'POST') {
      Object.assign(sync, body);
      return new Response(undefined, { status: 201 });
    }
    return json({ message: `no route ${method} ${url}` }, 404);
  };
  return { fetch, calls, table, sync };
}

// ── Printing ────────────────────────────────────────────────────────────────
function printPages(label, table) {
  console.log(`wiki_pages ${label} (${String(table.size)} rows)`);
  if (table.size === 0) {
    console.log('  (empty)');
    return;
  }
  const rows = [...table.values()].toSorted((a, b) => a.path.localeCompare(b.path));
  for (const row of rows) {
    console.log(`  ${row.path}`);
    console.log(
      `    blob ${short(row.blob_oid)}  commit ${short(row.commit_oid)}  title ${JSON.stringify(row.title)}` +
        `  updated ${row.updated ?? 'null'}`,
    );
    console.log(`    links ${JSON.stringify(row.links)}`);
    if (row.parse_error !== null && row.parse_error !== undefined) {
      console.log(`    parse_error ${JSON.stringify(row.parse_error.split('\n')[0])}`);
    }
  }
}

function printSync(label, sync) {
  const view = { ...sync, commit_oid: sync.commit_oid === undefined ? undefined : short(sync.commit_oid) };
  delete view.id;
  console.log(`wiki_sync ${label}  ${JSON.stringify(view)}`);
}

async function run(state, now) {
  const summary = await syncWiki(env, { fetch: state.fetch, now: new Date(now) });
  const view = summary.ok ? { ...summary, commitOid: short(summary.commitOid) } : summary;
  console.log(`syncWiki → ${JSON.stringify(view)}`);
  console.log(`subrequests ${String(state.calls.length)} (ceiling ${String(WIKI_SYNC_SUBREQUEST_CEILING)})`);
  for (const call of state.calls) console.log(`  ${call}`);
  state.calls.length = 0;
}

/** The snapshot as the first run leaves it — the starting point of the later sections. */
async function afterFirstRun() {
  const state = backend({ repo: REPO_1, commit: COMMIT_1 });
  await syncWiki(env, { fetch: state.fetch, now: new Date('2026-09-24T08:00:00.000Z') });
  return state;
}

const sections = {
  async first() {
    const state = backend({ repo: REPO_1, commit: COMMIT_1 });
    printPages('BEFORE', state.table);
    printSync('BEFORE', state.sync);
    console.log();
    await run(state, '2026-09-24T08:00:00.000Z');
    console.log();
    printPages('AFTER', state.table);
    printSync('AFTER', state.sync);
  },
  async push() {
    const { table, sync } = await afterFirstRun();
    printPages('BEFORE', table);
    printSync('BEFORE', sync);
    console.log();
    const state = backend({ repo: REPO_2, commit: COMMIT_2, table, sync });
    await run(state, '2026-09-25T09:17:00.000Z');
    console.log();
    printPages('AFTER', state.table);
    printSync('AFTER', state.sync);
  },
  async failed() {
    const { table, sync } = await afterFirstRun();
    printPages('BEFORE', table);
    printSync('BEFORE', sync);
    console.log();
    const state = backend({
      repo: REPO_2,
      commit: COMMIT_2,
      table,
      sync,
      treeError: 'API rate limit exceeded for installation',
    });
    await run(state, '2026-09-25T09:17:00.000Z');
    console.log();
    printPages('AFTER', state.table);
    printSync('AFTER', state.sync);
  },
};

const section = sections[process.argv[2]];
if (section === undefined) throw new Error(`section: one of ${Object.keys(sections).join(', ')}`);
await section();
