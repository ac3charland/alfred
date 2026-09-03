#!/usr/bin/env node
/**
 * The LLM Inbox classifier demo harness.
 *
 * It runs the REAL shipped sweep — `runSweep` out of `workers/src/sweep.ts`, bundled straight from
 * source — against a REAL PostgreSQL carrying the REAL migrations, and prints one section of the
 * resulting story per invocation:
 *
 *   node docs/demos/llm-inbox-classifier/sweep-harness.mjs <section>
 *
 *   capture         the seeded world, and one Inbox item as it stands BEFORE the sweep
 *   sweep           one real sweep, and the same row AFTER it
 *   prompt          the system prompt + output schema the sweeper actually assembled and sent
 *   claim           a human LABEL edit claiming an unclassified item away from the sweeper
 *   corrections     a dispatch with overridden labels, and the correction rows the trigger appended
 *   learn           the NEXT sweep's prompt, now carrying those corrections as worked examples
 *   claim-rule      which edits leave an unjudged row eligible, and which one claims it
 *   typed           a row the owner classified by hand, swept: the pinned schema and the result
 *   subtree         a decomposed task dispatched whole, every child filed under the root
 *   subtree-before  the same dispatch WITHOUT this story's migration — the CHECK it violates
 *
 * Every section runs the whole scenario from scratch (a fresh cluster takes ~1.5s), so each block
 * of the demo doc is a genuine end-to-end run rather than a slice of cached state.
 *
 * WHAT IS REAL AND WHAT IS STOOD UP LOCALLY
 *
 *   real   `runSweep`, `classify`, `buildRequest`, `validateVerdict`, `mergeIntoItem` — the shipped
 *          Worker modules, bundled by esbuild and imported unmodified.
 *   real   PostgreSQL with every migration in `database/migrations` applied in production order,
 *          so the claim trigger, the CHECK constraints and the dispatch-time diff are the real ones.
 *   local  a ~120-line `node:http` shim standing in for Supabase's PostgREST, translating the six
 *          request shapes `workers/src/supabase.ts` actually issues into SQL against that database.
 *   canned the Anthropic response. There is no live API key here, and a demo doc has to reproduce
 *          byte-for-byte, so `POST /v1/messages` is served locally and answers with a fixed verdict
 *          per item. The SDK call, the request assembly, the JSON parse, the validation and the
 *          write-back are all real; only the model's own answer is written by hand.
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

// ── Fixed identities ─────────────────────────────────────────────────────────
// Every id and every instant is a literal. `verify` re-runs each block and diffs the output, so
// nothing generated (uuids, wall-clock times, ports, temp paths) may reach stdout.
const ERRANDS = 'f0000000-0000-4000-8000-000000000001';
const HEALTH = 'f0000000-0000-4000-8000-000000000002';
const READING = 'f0000000-0000-4000-8000-000000000003';
const PROJECT = '70000000-0000-4000-8000-000000000001';
const EPIC = 'e0000000-0000-4000-8000-000000000001';

const DENTIST = 'a0000000-0000-4000-8000-000000000001';
const REGISTRATION = 'a0000000-0000-4000-8000-000000000002';
const RUST_BOOK = 'a0000000-0000-4000-8000-000000000003';
const RE_ASK = 'a0000000-0000-4000-8000-000000000004';

// ALF-202's own cast. The folder is seeded inside those sections rather than in `seedWorld`, so
// the closed world every earlier section prints is untouched.
const FAMILY = 'f0000000-0000-4000-8000-000000000004';
const BIRTHDAY = 'a0000000-0000-4000-8000-000000000005';
const RESTAURANT = 'a0000000-0000-4000-8000-000000000006';
const CAKE = 'a0000000-0000-4000-8000-000000000007';
const LIBRARY = 'a0000000-0000-4000-8000-000000000008';

// 02:30 UTC on the 6th is still 21:30 on the 5th in Chicago — deliberately an instant whose UTC
// date and whose America/Chicago date disagree, so the reference date in the prompt proves the
// zone was applied rather than merely being present.
const SWEEP_ONE_AT = new Date('2026-08-06T02:30:00Z');
const SWEEP_TWO_AT = new Date('2026-08-06T03:15:00Z');

const TIMEZONE = 'America/Chicago';
const MODEL = 'claude-haiku-4-5';

/** The verdicts the stand-in Anthropic endpoint returns, keyed by a word in the item's title. */
const CANNED_VERDICTS = [
  [
    'dentist',
    {
      item_type: 'task',
      priority: 'medium',
      due_date: '2026-08-07',
      folder_id: ERRANDS,
      intended_project_id: null,
      intended_epic_id: null,
    },
  ],
  [
    'registration',
    {
      item_type: 'task',
      priority: null,
      due_date: null,
      folder_id: ERRANDS,
      intended_project_id: null,
      intended_epic_id: null,
    },
  ],
  [
    'birthday',
    {
      // The owner already typed this one `task`, so the schema pins item_type to that single
      // value and echoing it is the only legal answer. The folder is what the row was missing.
      item_type: 'task',
      priority: null,
      due_date: null,
      folder_id: FAMILY,
      intended_project_id: null,
      intended_epic_id: null,
    },
  ],
  [
    'triaged',
    {
      item_type: 'code',
      priority: null,
      due_date: null,
      folder_id: null,
      intended_project_id: PROJECT,
      intended_epic_id: EPIC,
    },
  ],
];

const ABSTAIN = {
  item_type: null,
  priority: null,
  due_date: null,
  folder_id: null,
  intended_project_id: null,
  intended_epic_id: null,
};

function cannedVerdict(userMessage) {
  for (const [needle, verdict] of CANNED_VERDICTS) {
    if (userMessage.includes(needle)) return verdict;
  }
  return ABSTAIN;
}

// ── A shim for the six PostgREST shapes the Worker issues ────────────────────
// Not a PostgREST implementation: it recognises exactly the filters, selects and orderings that
// `workers/src/supabase.ts` sends, and refuses anything else rather than guessing.
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
    if (raw === 'is.null') {
      where.push(`${key} is null`);
    } else if (raw.startsWith('eq.')) {
      values.push(raw.slice(3));
      where.push(`${key} = $${values.length}`);
    } else if (raw.startsWith('lt.')) {
      values.push(Number(raw.slice(3)));
      where.push(`${key} < $${values.length}`);
    } else {
      throw new Error(`shim: unsupported filter ${key}=${raw}`);
    }
  }
  return { where, values };
}

async function runRest(client, request) {
  const url = new URL(request.url, 'http://rest.local');
  const match = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
  if (match === null) throw new Error(`shim: unsupported path ${url.pathname}`);
  const table = match[1];
  const { where, values } = translateFilters(url.searchParams);
  const filter = where.length > 0 ? ` where ${where.join(' and ')}` : '';

  if (request.method === 'GET') {
    const columns = url.searchParams.get('select') ?? '*';
    if (columns !== '*' && !COLUMN_LIST.test(columns)) {
      throw new Error(`shim: unsupported select ${columns}`);
    }
    let sql = `select ${columns} from ${table}${filter}`;
    const order = url.searchParams.get('order');
    if (order !== null) {
      const [column, direction] = order.split('.');
      if (!IDENTIFIER.test(column)) throw new Error(`shim: unsupported order ${order}`);
      sql += ` order by ${column} ${direction === 'desc' ? 'desc' : 'asc'}`;
    }
    const limit = url.searchParams.get('limit');
    if (limit !== null) sql += ` limit ${Number(limit)}`;
    const { rows } = await client.query(sql, values);
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
    // `Prefer: return=representation` — the Worker counts the returned rows to tell a real write
    // from a row that vanished between being read as eligible and the verdict coming back.
    const sql = `update ${table} set ${assignments.join(', ')}${filter} returning id`;
    const { rows } = await client.query(sql, values);
    return rows;
  }

  throw new Error(`shim: unsupported method ${request.method}`);
}

function startRest(client) {
  const server = createServer((request, response) => {
    runRest(client, request)
      .then((rows) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(rows));
      })
      .catch((error) => {
        // Mirror PostgREST: a rejected write comes back as a 4xx with the database's own message,
        // which is what turns a CHECK violation into the Worker's readable log line.
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end(String(error.message ?? error));
      });
  });
  return server;
}

// ── A stand-in for POST /v1/messages ─────────────────────────────────────────
function startAnthropic(captured) {
  const server = createServer((request, response) => {
    readBody(request)
      .then((raw) => {
        const body = JSON.parse(raw);
        const user = body.messages[0].content;
        captured.push({ system: body.system, user, schema: body.output_config.format.schema });
        const text = JSON.stringify(cannedVerdict(user));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'msg_demo',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        );
      })
      .catch(() => {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('bad request');
      });
  });
  return server;
}

// ── Printing ─────────────────────────────────────────────────────────────────
const out = [];
const say = (line = '') => out.push(line);

function show(label, value, comment = '') {
  const rendered = value === null || value === undefined ? '(null)' : String(value);
  const line =
    comment === ''
      ? `  ${label.padEnd(25)} ${rendered}`
      : `  ${label.padEnd(25)} ${rendered.padEnd(38)}${comment}`;
  say(line.trimEnd());
}

/** The six verdict keys in the order `workers/src/verdict.ts` declares them. */
const VERDICT_FIELDS = [
  'item_type',
  'priority',
  'due_date',
  'folder_id',
  'intended_project_id',
  'intended_epic_id',
];

/** `classified_guess`, re-serialised in the declared field order and wrapped so it stays readable. */
function showGuess(json, comment) {
  if (json === null) {
    show('classified_guess', null, comment);
    return;
  }
  const parsed = JSON.parse(json);
  const entries = VERDICT_FIELDS.filter((field) => field in parsed);
  say(`  ${'classified_guess'.padEnd(25)} ${comment}`.trimEnd());
  entries.forEach((field, index) => {
    const open = index === 0 ? '{' : ' ';
    const close = index === entries.length - 1 ? ' }' : ',';
    say(`      ${open} "${field}": ${JSON.stringify(parsed[field])}${close}`);
  });
}

function rule(title) {
  say(`── ${title} ${'─'.repeat(Math.max(0, 74 - title.length))}`.trimEnd());
}

const FOLDER_NAMES = new Map([
  [ERRANDS, 'Errands'],
  [HEALTH, 'Health'],
  [READING, 'Reading'],
  [FAMILY, 'Family'],
]);
const PROJECT_NAMES = new Map([[PROJECT, 'ALF · alfred']]);
const EPIC_NAMES = new Map([[EPIC, 'ALF-4 · Inbox classifier']]);

/** The comment column for an id field: the human name it resolves to, then the annotation. */
function idComment(id, names, comment) {
  const name = id === null ? undefined : names.get(id);
  return `${name === undefined ? '' : `(${name})  `}${comment}`.trimEnd();
}

/** One item row, with the classifier's six provenance columns spelled out. */
function showItem(row, comments = {}) {
  show('title', row.title);
  show('item_type', row.item_type, comments.item_type ?? '');
  show('priority', row.priority, comments.priority ?? '');
  show('due_date', row.due_date, comments.due_date ?? '');
  show('folder_id', row.folder_id, idComment(row.folder_id, FOLDER_NAMES, comments.folder_id ?? ''));
  show(
    'intended_project_id',
    row.intended_project_id,
    idComment(row.intended_project_id, PROJECT_NAMES, comments.intended_project_id ?? ''),
  );
  show(
    'intended_epic_id',
    row.intended_epic_id,
    idComment(row.intended_epic_id, EPIC_NAMES, comments.intended_epic_id ?? ''),
  );
  show('dispatched_at', row.dispatched_at, comments.dispatched_at ?? '');
  say('  ── provenance ──');
  show('classified_at', row.classified_at, comments.classified_at ?? '');
  show('classified_provider', row.classified_provider, comments.classified_provider ?? '');
  show('classified_model', row.classified_model);
  show('classified_prompt_version', row.classified_prompt_version);
  showGuess(row.classified_guess, comments.classified_guess ?? '');
  show('classify_attempts', row.classify_attempts, comments.classify_attempts ?? '');
}

/**
 * Read one item with every varying value already reduced to something stable: timestamps become
 * either the fixed instant the sweep was handed or a bare `not null`, and jsonb is re-serialised
 * in a fixed key order.
 */
async function readItem(client, id, stableClassifiedAt = false) {
  const { rows } = await client.query(
    `select title,
            item_type::text                                                        as item_type,
            priority::text                                                         as priority,
            to_char(due_date at time zone 'UTC', 'YYYY-MM-DD')                     as due_date,
            folder_id::text                                                        as folder_id,
            intended_project_id::text                                              as intended_project_id,
            intended_epic_id::text                                                 as intended_epic_id,
            case when dispatched_at is null then null else 'not null' end          as dispatched_at,
            case when classified_at is null then null
                 when $2 then 'not null'
                 else to_char(classified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            end                                                                    as classified_at,
            classified_provider,
            classified_model,
            classified_prompt_version,
            classified_guess::text                                                 as classified_guess,
            classify_attempts
       from items where id = $1`,
    [id, stableClassifiedAt],
  );
  return rows[0];
}

// ── The scenario ─────────────────────────────────────────────────────────────
async function seedWorld(client) {
  await client.query(
    `insert into folders (id, name, description) values
       ($1, 'Errands', 'Things that have to happen out in the world: appointments, calls, forms, shop trips.'),
       ($2, 'Health',  'Doctors, dentists, prescriptions, exercise: anything to do with the body.'),
       ($3, 'Reading', null)`,
    [ERRANDS, HEALTH, READING],
  );
  await client.query(
    `insert into projects (id, key, name, repo_owner, repo_name, description)
       values ($1, 'ALF', 'alfred', 'ac3charland', 'alfred',
               'The task app itself: its schema, its frontend, its workers.')`,
    [PROJECT],
  );
  await client.query(
    `insert into epics (id, project_id, name, ref_number, ref)
       values ($1, $2, 'Inbox classifier', 4, 'ALF-4')`,
    [EPIC, PROJECT],
  );
}

/** One capture. A SUBTASK arrives as a `task` rather than `unclassified`, because
 *  items_task_only_fields refuses any other type on a row that has a parent. */
async function capture(client, id, title, createdAt, parentId = null) {
  await client.query(
    `insert into items (id, title, created_at, parent_id, item_type)
       values ($1, $2, $3, $4, $5)`,
    [id, title, createdAt, parentId, parentId === null ? 'unclassified' : 'task'],
  );
}

/** The claim marker as a sentence, so a block can print it after every single edit. */
async function markerOf(client, id) {
  const { rows } = await client.query(
    `select case when classified_at is null then 'null  → still eligible'
                 else 'SET   → claimed' end                        as marker,
            coalesce(classified_provider, 'null') as provider
       from items where id = $1`,
    [id],
  );
  return rows[0];
}

/** One row of a dispatched subtree, reduced to the four facts the trigger is about. The marker
 *  column spells out WHO set classified_at, since "set" alone reads the same for a verdict and a
 *  claim, and the whole point of the row below is that no child is claimed. */
async function showSubtree(client, ids) {
  say(`  ${'title'.padEnd(30)} ${'folder'.padEnd(10)} ${'dispatched'.padEnd(11)} classified_at`);
  for (const id of ids) {
    const { rows } = await client.query(
      `select title, folder_id::text as folder_id,
              case when dispatched_at is null then 'no' else 'yes' end as dispatched,
              case when classified_at is null then 'null'
                   when classified_provider is null then 'set · by you'
                   else 'set · by the classifier' end as marker
         from items where id = $1`,
      [id],
    );
    const row = rows[0];
    const folder = row.folder_id === null ? '(none)' : (FOLDER_NAMES.get(row.folder_id) ?? '?');
    say(`  ${row.title.padEnd(30)} ${folder.padEnd(10)} ${row.dispatched.padEnd(11)} ${row.marker}`);
  }
}

/** The Family folder, seeded only for ALF-202's own sections. */
async function seedFamily(client) {
  await client.query(
    `insert into folders (id, name, description) values
       ($1, 'Family', 'Birthdays, visits, presents: anything with the people in it.')`,
    [FAMILY],
  );
}

async function main() {
  const section = process.argv[2];
  const cluster = await startCluster();
  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  const captured = [];
  const anthropicServer = startAnthropic(captured);
  const bundleDir = mkdtempSync(path.join(tmpdir(), 'alfred-sweep-'));
  let pool;
  let restServer;

  try {
    await client.connect();
    // Pin the zone database-wide, so a bare `YYYY-MM-DD` written into a timestamptz lands on UTC
    // midnight — exactly as the migration's comment describes — on every connection.
    await client.query(`alter database ${cluster.database} set timezone to 'UTC'`);
    await client.query(`set time zone 'UTC'`);
    await bootstrapSupabase(client);
    // The `subtree-before` block applies everything EXCEPT this story's migration, so it can show
    // the failure the new inheritance trigger fixes.
    await applyMigrations(
      client,
      undefined,
      (file) => section !== 'subtree-before' || !file.includes('0031_'),
    );
    await seedWorld(client);

    // The Worker fetches folders, projects and epics concurrently, so the shim needs a pool: a
    // single `pg.Client` cannot have two queries in flight.
    pool = new pg.Pool({
      host: cluster.host,
      port: cluster.port,
      user: cluster.user,
      database: cluster.database,
    });
    restServer = startRest(pool);

    const restPort = await listen(restServer);
    const anthropicPort = await listen(anthropicServer);

    // The SDK reads its base URL from the environment at construction time, which happens inside
    // `classify` — so this must be set before the sweep runs, and is set before the import to
    // leave no doubt about ordering.
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicPort}`;

    // The Worker sources import each other extensionlessly (`from './verdict'`), which Node's ESM
    // resolver rejects — so bundle the real entry point rather than reimplementing it.
    const bundle = path.join(bundleDir, 'sweep.mjs');
    await build({
      entryPoints: [fileURLToPath(new URL('../../../workers/src/sweep.ts', import.meta.url))],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const { runSweep } = await import(pathToFileURL(bundle).href);

    const env = {
      SUPABASE_URL: `http://127.0.0.1:${restPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'demo-service-role-key',
      ANTHROPIC_API_KEY: 'demo-key-the-local-endpoint-ignores',
      CLASSIFIER_MODEL: MODEL,
      CLASSIFIER_TIMEZONE: TIMEZONE,
    };

    // ── ALF-202's own sections ────────────────────────────────────────────────
    // They run BEFORE the three captures below and return, so the sweep each one runs sees only
    // the rows it seeded — and every earlier section's output is untouched by their existence.

    if (section === 'claim-rule') {
      await seedFamily(client);
      await capture(client, BIRTHDAY, "Plan Mom's birthday", '2026-08-05T14:00:00Z');
      rule('one unjudged capture, five edits, one UPDATE each');
      say('  classified_at is read straight after every edit. Null means the sweep may still');
      say('  judge the row; set means it is the owner\'s and the sweeper never revisits.');
      say();
      say(`  ${'the edit'.padEnd(34)} ${'classified_at'.padEnd(24)} provider`);
      const edits = [
        ['rewrite the title', `update items set title = 'Plan Mom''s 70th' where id = $1`],
        [
          'add a description',
          `update items set notes = 'She wants the whole family there.' where id = $1`,
        ],
        ['classify it as a task', `update items set item_type = 'task' where id = $1`],
        ['rewrite the title again', `update items set title = 'Plan Mom''s 70th birthday' where id = $1`],
        ['file it under Family', `update items set folder_id = '${FAMILY}' where id = $1`],
      ];
      for (const [label, sql] of edits) {
        await client.query(sql, [BIRTHDAY]);
        const { marker, provider } = await markerOf(client, BIRTHDAY);
        say(`  ${label.padEnd(34)} ${marker.padEnd(24)} ${provider}`);
      }
      say();
      say('  The first four are the classifier\'s INPUT and its locked field. The fifth is a');
      say('  LABEL the classifier writes — that is the one that claims, with no provider,');
      say('  because no model produced it.');
      say();

      // The other half of the rule, on rows of their own: clearing a label states as much as
      // setting one, and a referential cascade states nothing at all.
      rule('the other label edits, each on its own unjudged row');
      const dated = 'a0000000-0000-4000-8000-000000000009';
      await client.query(
        `insert into items (id, title, item_type, due_date, created_at)
           values ($1, 'Renew the car registration', 'task', '2026-08-07', '2026-08-05T14:05:00Z')`,
        [dated],
      );
      const filed = 'a0000000-0000-4000-8000-00000000000a';
      await client.query(
        `insert into items (id, title, item_type, folder_id, created_at)
           values ($1, 'Look into that Rust book', 'task', $2, '2026-08-05T14:10:00Z')`,
        [filed, READING],
      );
      // 0026 files an item at insert when it arrives with a folder; the sweeper's rows are in
      // the Inbox, so put it back there before the delete cascade under test.
      await client.query(`update items set dispatched_at = null where id = $1`, [filed]);
      const prioritised = 'a0000000-0000-4000-8000-00000000000b';
      await client.query(
        `insert into items (id, title, item_type, created_at)
           values ($1, 'Renew the passport', 'task', '2026-08-05T14:20:00Z')`,
        [prioritised],
      );
      say(`  ${'the edit'.padEnd(34)} ${'classified_at'.padEnd(24)} provider`);
      await client.query(`update items set priority = 'high' where id = $1`, [prioritised]);
      const raised = await markerOf(client, prioritised);
      say(`  ${'set a priority'.padEnd(34)} ${raised.marker.padEnd(24)} ${raised.provider}`);
      await client.query(`update items set due_date = null where id = $1`, [dated]);
      const cleared = await markerOf(client, dated);
      say(`  ${'clear its due date'.padEnd(34)} ${cleared.marker.padEnd(24)} ${cleared.provider}`);
      await client.query(`delete from folders where id = $1`, [READING]);
      const cascaded = await markerOf(client, filed);
      say(`  ${'delete its folder'.padEnd(34)} ${cascaded.marker.padEnd(24)} ${cascaded.provider}`);
      say();
      say('  Clearing claims: on an unjudged row the value being emptied can only have come');
      say('  from you or from the capture that created it. A folder DELETE does not — it nulls');
      say('  folder_id with nobody stating anything, and those are the rows that most need');
      say('  re-triaging, so the FK columns claim in the non-null direction only.');
      return;
    }

    if (section === 'typed' || section === 'subtree' || section === 'subtree-before') {
      await seedFamily(client);
      await capture(client, BIRTHDAY, "Plan Mom's birthday", '2026-08-05T14:00:00Z');
      // The gesture the ticket is about: a bare `{ item_type: 'task' }` PATCH from the row menu,
      // which is the only way to give a capture children at all.
      await client.query(`update items set item_type = 'task' where id = $1`, [BIRTHDAY]);
      await capture(client, RESTAURANT, 'Book the restaurant', '2026-08-05T14:01:00Z', BIRTHDAY);
      await capture(client, CAKE, 'Order the cake', '2026-08-05T14:02:00Z', BIRTHDAY);
    }

    if (section === 'typed') {
      // A second, untyped capture in the same sweep, purely for the contrast in the schema below.
      await capture(
        client,
        LIBRARY,
        'Look into that Rust book everyone keeps mentioning',
        '2026-08-05T14:03:00Z',
      );
      const typedBefore = await readItem(client, BIRTHDAY);
      rule('the row the owner classified by hand, BEFORE the sweep');
      showItem(typedBefore, {
        item_type: "← the owner's answer, set from the ⋯ menu",
        classified_at: '← STILL NULL: classifying no longer claims the row',
      });
      say();

      const typedSummary = await runSweep(env, SWEEP_ONE_AT);
      rule('runSweep(env, 2026-08-06T02:30:00Z)');
      say(`  ${JSON.stringify(typedSummary)}`);
      say('  items sent to the model, in capture order:');
      for (const request of captured) say(`    ${request.user.split('\n')[0]}`);
      say('  (the two subtasks are absent — the sweep selects parent_id is null only)');
      say();

      const typedRequest = captured.find((request) => request.user.includes('birthday'));
      const untypedRequest = captured.find((request) => request.user.includes('Rust book'));
      rule('the user message for the hand-classified row');
      for (const line of typedRequest.user.split('\n')) say(`  ${line}`.trimEnd());
      say();
      rule('output_config.format.schema → properties.item_type');
      say('  the hand-classified row — one legal answer, no null branch:');
      for (const line of JSON.stringify(typedRequest.schema.properties.item_type, null, 2).split('\n'))
        say(`    ${line}`);
      say('  the untyped row in the SAME sweep — unchanged:');
      for (const line of JSON.stringify(untypedRequest.schema.properties.item_type, null, 2).split('\n'))
        say(`    ${line}`);
      say();
      rule('the row AFTER the sweep');
      showItem(await readItem(client, BIRTHDAY), {
        item_type: '← still the owner\'s: the merge never overwrites a held type',
        folder_id: '← the gap the model filled, which is what makes it dispatch-ready',
        classified_at: '← the instant the sweep was handed',
        classified_provider: '← a model produced this verdict',
      });
      return;
    }

    if (section === 'subtree') {
      await runSweep(env, SWEEP_ONE_AT);
      rule('after the sweep — the root is filed, the children are not');
      await showSubtree(client, [BIRTHDAY, RESTAURANT, CAKE]);
      say();
      say('  Dispatch PATCHes every row of the subtree together, so the order is not the app\'s');
      say('  to choose. Below it is the awkward one: the children go first.');
      say();
      for (const id of [CAKE, RESTAURANT, BIRTHDAY]) {
        await client.query(`update items set dispatched_at = now() where id = $1`, [id]);
      }
      rule('after the dispatch — every row filed, no CHECK violation');
      await showSubtree(client, [BIRTHDAY, RESTAURANT, CAKE]);
      say();
      say('  The children inherited the ROOT\'s folder, and neither was claimed on the way: the');
      say('  claim trigger sorts before the inheritance trigger, so it sees folder_id still null.');
      return;
    }

    if (section === 'subtree-before') {
      rule('the same three rows, on the schema WITHOUT this story\'s migration');
      // The sweep cannot produce this shape here — the old claim rule stamps the row the moment
      // it is classified, so it is never swept — so the classifier's write is made by hand.
      await client.query(
        `update items set folder_id = $2, classified_at = now(),
                          classified_provider = 'anthropic'
           where id = $1`,
        [BIRTHDAY, FAMILY],
      );
      await showSubtree(client, [BIRTHDAY, RESTAURANT, CAKE]);
      say();
      say('  Dispatching the first child:');
      let failure = 'it was accepted';
      try {
        await client.query(`update items set dispatched_at = now() where id = $1`, [CAKE]);
      } catch (error) {
        failure = error.message;
      }
      say(`    ${failure}`);
      say();
      say('  That is the constraint 0026 added, doing its job: a dispatched task must hold a');
      say('  folder, and nothing was cascading the root\'s down to its children.');
      return;
    }

    // 1. Three captures, all unclassified, all in the Inbox.
    await capture(
      client,
      DENTIST,
      'Call the dentist about the crown — they said to ring back Friday',
      '2026-08-05T14:00:00Z',
    );
    await capture(client, REGISTRATION, 'Renew the car registration', '2026-08-05T14:05:00Z');
    await capture(
      client,
      RUST_BOOK,
      'Look into that Rust book everyone keeps mentioning',
      '2026-08-05T14:10:00Z',
    );

    const before = await readItem(client, DENTIST);

    if (section === 'capture') {
      rule('the world the model may choose from');
      const { rows: folders } = await client.query(
        `select name, coalesce(description, '(no description)') as description
           from folders order by name`,
      );
      for (const folder of folders) say(`  folder   ${folder.name.padEnd(10)} ${folder.description}`);
      const { rows: projects } = await client.query(`select key, name from projects order by key`);
      for (const project of projects) say(`  project  ${project.key} · ${project.name}`);
      const { rows: epics } = await client.query(`select ref, name from epics order by ref`);
      for (const epic of epics) say(`  epic     ${epic.ref} · ${epic.name}`);
      say();
      rule('items.id = a0000000-0000-4000-8000-000000000001, BEFORE the sweep');
      showItem(before, {
        item_type: '← nobody has decided what this is',
        dispatched_at: '← still in the Inbox',
        classified_at: '← no marker, so the sweep is allowed to look at it',
      });
      return;
    }

    // 2. A human sets a LABEL on an unclassified item before the sweeper ever reaches it.
    await client.query(`update items set folder_id = $2 where id = $1`, [RUST_BOOK, READING]);

    // 3. One real sweep.
    const summaryOne = await runSweep(env, SWEEP_ONE_AT);
    const after = await readItem(client, DENTIST);

    if (section === 'sweep') {
      rule('runSweep(env, 2026-08-06T02:30:00Z) — the real cron body');
      say(`  ${JSON.stringify(summaryOne)}`);
      say();
      say('  items the sweep sent to the model, in capture order:');
      for (const request of captured) say(`    ${request.user.split('\n')[0]}`);
      say();
      rule('items.id = a0000000-0000-4000-8000-000000000001, AFTER the sweep');
      showItem(after, {
        item_type: '← guessed, written onto the real column',
        priority: '← guessed',
        due_date: '← "Friday", resolved against the reference date',
        folder_id: '← guessed',
        dispatched_at: '← STILL NULL: the sweep never dispatches',
        classified_at: '← the instant the sweep was handed',
        classified_provider: '← a model produced this verdict',
      });
      return;
    }

    if (section === 'prompt') {
      const request = captured[0];
      rule('the system prompt the sweeper assembled for the dentist item');
      for (const line of request.system.split('\n')) say(`  ${line}`.trimEnd());
      say();
      rule('the user message');
      for (const line of request.user.split('\n')) say(`  ${line}`.trimEnd());
      say();
      rule('output_config.format.schema — rebuilt this sweep from the live ids');
      for (const line of JSON.stringify(request.schema, null, 2).split('\n')) say(`  ${line}`);
      return;
    }

    if (section === 'claim') {
      const claimed = await readItem(client, RUST_BOOK, true);
      rule('items.id = a0000000-0000-4000-8000-000000000003 — filed by hand, then swept');
      say('  The only change a human made was filing it under Reading — a label the classifier');
      say('  writes. The sweep then ran over the Inbox.');
      say();
      showItem(claimed, {
        item_type: '← untouched: no model ever saw this row',
        folder_id: "← the owner's answer, and the edit that claimed the row",
        classified_at:
          '← stamped by the claim trigger, not by a sweep',
        classified_provider: '← null provider = NO MODEL RAN',
      });
      say();
      say('  the sweep asked the model about:');
      for (const request of captured) say(`    ${request.user.split('\n')[0]}`);
      say('  (this item is absent — a claimed row drops out of the sweep predicate for good)');
      return;
    }

    // 4. Dispatch — the one unambiguous "these labels are final" event.
    await client.query(
      `update items set dispatched_at = now(), folder_id = $2, priority = null where id = $1`,
      [DENTIST, HEALTH],
    );
    await client.query(`update items set dispatched_at = now(), priority = 'high' where id = $1`, [
      REGISTRATION,
    ]);

    if (section === 'corrections') {
      rule('what the owner did at dispatch');
      say('  "Call the dentist about the crown — they said to ring back Friday"');
      say('     folder   Errands  →  Health        (the model picked the wrong one)');
      say('     priority medium   →  (cleared)     (the model should have abstained)');
      say('     due date 2026-08-07 kept, item type task kept — no disagreement, no row');
      say('  "Renew the car registration"');
      say('     priority (blank)  →  high          (the model could have known)');
      say();
      const dispatched = await readItem(client, DENTIST);
      rule('the dentist item after dispatch');
      showItem(dispatched, {
        folder_id: "← the owner's answer, not the guess",
        priority: '← the owner cleared it',
        dispatched_at: '← a human act; it has left the Inbox',
        classified_guess: '← the guess is kept, so the diff has something to compare',
      });
      say();
      rule('classification_corrections — appended by the dispatch trigger');
      const { rows: corrections } = await client.query(
        `select field, direction,
                coalesce(guessed_value, '(none)') as guessed_value,
                coalesce(chosen_value,  '(none)') as chosen_value,
                provider, model, prompt_version, captured_text
           from classification_corrections
          order by field, direction`,
      );
      for (const row of corrections) {
        say(`  ${row.direction.padEnd(10)} ${row.field}`);
        say(`    captured  "${row.captured_text}"`);
        say(`    guessed   ${row.guessed_value}`);
        say(`    chosen    ${row.chosen_value}`);
        say(`    stamped   ${row.provider} / ${row.model} / prompt v${row.prompt_version}`);
        say();
      }
      say(`  ${corrections.length} rows, ${new Set(corrections.map((r) => r.direction)).size} distinct directions`);
      return;
    }

    // 5. A new capture, and the next sweep — which now reads the corrections back.
    await capture(
      client,
      RE_ASK,
      "ALF: don't re-ask about items I've already triaged",
      '2026-08-06T03:00:00Z',
    );
    const beforeSecond = captured.length;
    const summaryTwo = await runSweep(env, SWEEP_TWO_AT);

    if (section === 'learn') {
      const request = captured[beforeSecond];
      rule('runSweep(env, 2026-08-06T03:15:00Z) — the next tick');
      say(`  ${JSON.stringify(summaryTwo)}`);
      say();
      rule('the few-shot block the next prompt now carries');
      const marker = 'Examples of past corrections';
      const examples = request.system.slice(request.system.indexOf(marker));
      for (const line of examples.split('\n')) say(`  ${line}`.trimEnd());
      say();
      rule('the same ids, unresolved, as the log stores them');
      const { rows } = await client.query(
        `select field, direction, coalesce(guessed_value, '(none)') as guessed_value,
                coalesce(chosen_value, '(none)') as chosen_value
           from classification_corrections where field = 'folder_id'`,
      );
      for (const row of rows) {
        say(`  ${row.field} (${row.direction})`);
        say(`    guessed_value  ${row.guessed_value}`);
        say(`    chosen_value   ${row.chosen_value}`);
      }
      return;
    }

    throw new Error(`unknown section: ${String(section)}`);
  } finally {
    process.stdout.write(`${out.join('\n')}\n`);
    restServer?.close();
    anthropicServer.close();
    await pool?.end().catch(() => undefined);
    await client.end().catch(() => undefined);
    cluster.stop();
    rmSync(bundleDir, { recursive: true, force: true });
  }
}

await main();
