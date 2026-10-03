#!/usr/bin/env node
/**
 * Due times through the REAL classifier sweep: `runSweep` out of `workers/src/sweep.ts`, bundled
 * straight from source, against a REAL PostgreSQL carrying every migration.
 *
 *   node docs/demos/due-times/sweep-harness.mjs
 *
 * REAL     `runSweep`, `buildRequest`, `validateVerdict`, `mergeIntoItem`, the eligible-items
 *          select and the PATCH — the shipped Worker modules, imported unmodified — and Postgres
 *          with the claim trigger, the CHECKs and the dispatch-time corrections diff.
 * LOCAL    a small `node:http` shim standing in for PostgREST: it turns the GETs and PATCHes the
 *          Worker issues into SQL against that database.
 * CANNED   the model's answer. There is no API key here, and the doc must reproduce byte for
 *          byte, so `POST /v1/messages` answers with a fixed verdict per capture. Everything the
 *          Worker does with that answer is real. (Adapted from
 *          docs/demos/llm-inbox-classifier/sweep-harness.mjs.)
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const HEALTH = 'f1610000-0000-4000-8000-000000000001';
const CAPTURES = [
  // [id, title, held due_date]
  ['a1610000-0000-4000-8000-000000000001', 'dentist tomorrow at 3pm', null],
  ['a1610000-0000-4000-8000-000000000002', 'call mom tonight', null],
  ['a1610000-0000-4000-8000-000000000003', 'standup at 9:30', null],
  ['a1610000-0000-4000-8000-000000000004', 'pay rent by 5', null],
  ['a1610000-0000-4000-8000-000000000005', 'haircut at 3pm', '2026-10-06'],
];
const DENTIST = CAPTURES[0][0];

// Saturday 3 October 2026, 14:00 in Chicago — the classifier's "today".
const SWEEP_AT = new Date('2026-10-03T19:00:00Z');

/** What the stand-in model answers, keyed by a word in the capture. */
const CANNED = [
  // A stated clock time and a stated day.
  ['dentist', { due_date: '2026-10-04', due_time: '15:00', folder_id: HEALTH }],
  // "tonight" names the day, not a clock time — the prompt's rule, followed.
  ['tonight', { due_date: '2026-10-03', due_time: null, folder_id: null }],
  // A model that broke the rule and answered a time with no date.
  ['standup', { due_date: null, due_time: '09:30', folder_id: null }],
  // A model that answered a time in the wrong shape.
  ['rent', { due_date: '2026-10-03', due_time: '5pm', folder_id: null }],
  // A time guessed for a day other than the one the owner already set.
  ['haircut', { due_date: '2026-10-04', due_time: '15:00', folder_id: null }],
];

function verdictFor(userMessage) {
  const hit = CANNED.find(([needle]) => userMessage.includes(needle));
  return {
    item_type: 'task',
    priority: null,
    intended_project_id: null,
    intended_epic_id: null,
    ...(hit === undefined ? { due_date: null, due_time: null, folder_id: null } : hit[1]),
  };
}

// ── A shim for the PostgREST shapes the Worker issues ────────────────────────
const RESERVED = new Set(['select', 'order', 'limit', 'offset']);
const IDENTIFIER = /^[a-z_]+$/;
const COLUMN_LIST = /^[a-z_,]+$/;

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => resolve(raw));
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function translateFilters(params) {
  const where = [];
  const values = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    if (!IDENTIFIER.test(key)) throw new Error(`shim: unsupported filter column ${key}`);
    if (raw === 'is.null') where.push(`${key} is null`);
    else if (raw.startsWith('eq.')) {
      values.push(raw.slice(3));
      where.push(`${key} = $${values.length}`);
    } else if (raw.startsWith('lt.')) {
      values.push(Number(raw.slice(3)));
      where.push(`${key} < $${values.length}`);
    } else throw new Error(`shim: unsupported filter ${key}=${raw}`);
  }
  return { where, values };
}

async function runRest(db, request) {
  const url = new URL(request.url, 'http://rest.local');
  const match = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
  if (match === null) throw new Error(`shim: unsupported path ${url.pathname}`);
  const table = match[1];
  const { where, values } = translateFilters(url.searchParams);
  const filter = where.length > 0 ? ` where ${where.join(' and ')}` : '';
  if (request.method === 'GET') {
    const columns = url.searchParams.get('select') ?? '*';
    if (columns !== '*' && !COLUMN_LIST.test(columns)) throw new Error(`shim: select ${columns}`);
    let sql = `select ${columns} from ${table}${filter}`;
    const order = url.searchParams.get('order');
    if (order !== null) {
      const [column, direction] = order.split('.');
      sql += ` order by ${column} ${direction === 'desc' ? 'desc' : 'asc'}`;
    }
    const limit = url.searchParams.get('limit');
    if (limit !== null) sql += ` limit ${Number(limit)}`;
    // PostgREST serialises a `time` as HH:MM:SS, as pg does with `::text`.
    const { rows } = await db.query(sql, values);
    return rows;
  }
  if (request.method === 'PATCH') {
    const body = JSON.parse(await readBody(request));
    const assignments = [];
    for (const [column, value] of Object.entries(body)) {
      if (!IDENTIFIER.test(column)) throw new Error(`shim: unsupported column ${column}`);
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }
    const { rows } = await db.query(
      `update ${table} set ${assignments.join(', ')}${filter} returning id`,
      values,
    );
    return rows;
  }
  throw new Error(`shim: unsupported method ${request.method}`);
}

function startRest(db) {
  return createServer((request, response) => {
    runRest(db, request)
      .then((rows) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(rows));
      })
      .catch((error) => {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end(String(error.message ?? error));
      });
  });
}

function startAnthropic(captured) {
  return createServer((request, response) => {
    readBody(request)
      .then((raw) => {
        const body = JSON.parse(raw);
        const user = body.messages[0].content;
        captured.push({ system: body.system, user, schema: body.output_config.format.schema });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'msg_demo',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text: JSON.stringify(verdictFor(user)) }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        );
      })
      .catch(() => {
        response.writeHead(500);
        response.end();
      });
  });
}

// ── The scenario ─────────────────────────────────────────────────────────────
const out = [];
const say = (line = '') => out.push(line);

const cluster = await startCluster();
const connection = { host: cluster.host, port: cluster.port, user: cluster.user, database: cluster.database };
const client = new pg.Client(connection);
const captured = [];
const anthropic = startAnthropic(captured);
const bundleDir = mkdtempSync(path.join(tmpdir(), 'alfred-due-time-sweep-'));
let pool;
let rest;
try {
  await client.connect();
  await client.query(`alter database ${cluster.database} set timezone to 'UTC'`);
  await client.query(`set time zone 'UTC'`);
  await bootstrapSupabase(client);
  await applyMigrations(client);
  await client.query(`insert into folders (id, name, description) values ($1, 'Health', 'Doctors and dentists.')`, [HEALTH]);
  for (const [id, title, held] of CAPTURES) {
    await client.query(
      `insert into items (id, title, item_type, due_date, created_at)
         values ($1, $2, $3, $4, '2026-10-03T18:00:00Z')`,
      [id, title, held === null ? 'unclassified' : 'task', held],
    );
  }

  pool = new pg.Pool(connection);
  rest = startRest(pool);
  const restPort = await listen(rest);
  const anthropicPort = await listen(anthropic);
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicPort}`;

  const bundle = path.join(bundleDir, 'sweep.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../../../workers/src/sweep.ts', import.meta.url))],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const { runSweep } = await import(pathToFileURL(bundle).href);
  const summary = await runSweep(
    {
      SUPABASE_URL: `http://127.0.0.1:${restPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'demo-service-role-key',
      ANTHROPIC_API_KEY: 'demo-key-the-local-endpoint-ignores',
      CLASSIFIER_MODEL: 'claude-haiku-4-5',
      CLASSIFIER_TIMEZONE: 'America/Chicago',
    },
    SWEEP_AT,
  );

  const sent = captured.find((request) => request.user.includes('dentist'));
  say('── what the sweep sent the model ──');
  say(`  ${sent.system.split('\n').find((line) => line.startsWith('- due_time')) ?? ''}`);
  say(`  schema.due_time = ${JSON.stringify(sent.schema.properties.due_time)}`);
  say(`  due_time required: ${String(sent.schema.required.includes('due_time'))}`);
  say();
  say(`── runSweep → ${JSON.stringify(summary)} ──`);
  say(`  ${'capture'.padEnd(24)} ${'model answered'.padEnd(26)} row now holds`);
  for (const [id, title] of CAPTURES) {
    const { rows } = await client.query(
      `select to_char(due_date at time zone 'UTC', 'YYYY-MM-DD') as date,
              to_char(due_time, 'HH24:MI') as time,
              classified_prompt_version as version,
              classified_guess ->> 'due_time' as guessed_time
         from items where id = $1`,
      [id],
    );
    const row = rows[0];
    const answer = verdictFor(title);
    const answered = `${answer.due_date ?? '—'} ${answer.due_time ?? '—'}`;
    say(`  ${title.padEnd(24)} ${answered.padEnd(26)} ${row.date ?? '—'} ${row.time ?? '—'}  (v${String(row.version)}, guess.due_time=${row.guessed_time ?? 'none'})`);
  }
  say();

  say('── the owner moves the dentist to 16:30, then files it ──');
  await client.query(`update items set due_time = '16:30' where id = $1`, [DENTIST]);
  await client.query(`update items set dispatched_at = now() where id = $1`, [DENTIST]);
  const { rows: corrections } = await client.query(
    `select field, direction, guessed_value, chosen_value from classification_corrections
      where item_id = $1 order by field`,
    [DENTIST],
  );
  for (const row of corrections) {
    say(`  ${row.field}: ${row.direction} (${row.guessed_value ?? '—'} → ${row.chosen_value ?? '—'})`);
  }
} finally {
  process.stdout.write(`${out.join('\n')}\n`);
  rest?.close();
  anthropic.close();
  await pool?.end().catch(() => undefined);
  await client.end().catch(() => undefined);
  cluster.stop();
  rmSync(bundleDir, { recursive: true, force: true });
}
