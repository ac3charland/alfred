#!/usr/bin/env node
/**
 * The Worker half of the re-run feedback demo: what the comms sweep now does with a re-run request
 * that can never succeed.
 *
 *   node docs/demos/alf-221-rerun-feedback/worker-harness.mjs <section>
 *
 *   before   the row a re-run keeps failing on, as it stands
 *   abandon  one sweep tick: the request is given up on, with no model call, the verdict kept
 *   no-tier  the same for a row that never had a tier — abandoned, then parked, in one tick
 *   two-stalled two tier-less stalled re-runs, two ticks: each is abandoned and parked on its own turn
 *   newer    the owner asks AGAIN between the sweep's read and its write: the newer request survives
 *   worklist the re-run worklist no longer reads a row at the ceiling — even when the write that
 *            would give up on it is refused, so a stalled request is never billed again
 *
 * REAL: `runCommsSweep` out of `workers/src/comms/sweep.ts`, bundled straight from source by
 * esbuild and imported unmodified — the reads it makes, the write it sends, the order of both.
 * STOOD UP LOCALLY: the database, as a few-line in-memory `comm_messages` table that applies the
 * PostgREST filters the sweep uses (`eq.`, `lt.`, `gte.`, `is.null`, `not.is.null`) and ignores
 * `order`, so a write whose filter no longer matches really does match nothing. It is an
 * illustration of the sweep's requests, not a model of Postgres: `eq.` here compares text. The
 * real Postgres behaviour of that conditional write is pinned separately, in the `database`
 * integration suite. There is no live Anthropic key: any call to the model is recorded and refused,
 * which is how "no model call" is shown rather than claimed.
 *
 * Output is deterministic: ids and instants are literals.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NOW = new Date('2026-09-09T15:00:00.000Z');
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const DANA = 'b0000000-0000-4000-8000-000000000001';
const DANA_TWO = 'b0000000-0000-4000-8000-000000000002';
const REQUESTED = '2026-09-09T14:50:00.123456+00:00';

const section = process.argv[2] ?? '';

/** A `comm_messages` row exactly as PostgREST returns it: every nullable column present. */
function row(overrides) {
  return {
    id: DANA,
    account_id: ACCOUNT,
    source_id: 'gmail-1',
    rfc822_message_id: null,
    thread_key: 'thread-1',
    direction: 'inbound',
    sender_handle: 'dana@example.com',
    sender_name: 'Dana Whitfield',
    chat_name: null,
    participants: [],
    subject: 'Thursday standup',
    body: 'Any chance you could run standup Thursday?',
    received_at: '2026-09-09T13:00:00.000Z',
    body_extracted: true,
    has_attachments: false,
    has_list_header: false,
    in_reply_to: null,
    references_ids: [],
    filtered_reason: null,
    classify_attempts: 0,
    tier: null,
    judged_by: null,
    ask: null,
    verdict_id: null,
    classified_at: null,
    reclassify_requested_at: null,
    reclassify_failed_at: null,
    cleared_at: null,
    cleared_by: null,
    inbox_item_id: null,
    created_at: '2026-09-09T13:00:05.000Z',
    ...overrides,
  };
}

/** The row a re-run of an already-judged message keeps failing on: five attempts spent. */
const STALLED = () =>
  row({
    tier: 'today',
    judged_by: 'model',
    ask: 'Wants you to cover Thursday’s standup.',
    verdict_id: 'v0000000-0000-4000-8000-000000000001',
    classified_at: '2026-09-08T10:00:00.000Z',
    classify_attempts: 5,
    reclassify_requested_at: REQUESTED,
  });

// ── A tiny PostgREST over one table ──────────────────────────────────────────
const NULLISH = (value) => value === null || value === undefined;

/** Does `value` satisfy one PostgREST filter such as `lt.5` or `not.is.null`? */
function matches(value, filter) {
  if (filter === 'is.null') return NULLISH(value);
  if (filter === 'not.is.null') return !NULLISH(value);
  const [op, ...rest] = filter.split('.');
  const operand = rest.join('.');
  if (op === 'eq') return String(value) === operand;
  if (op === 'lt') return Number(value) < Number(operand);
  if (op === 'gte') return Number(value) >= Number(operand);
  throw new Error(`the demo table does not know the filter ${filter}`);
}

const RESERVED = new Set(['select', 'order', 'limit']);

function select(table, params) {
  const rows = table.filter((candidate) =>
    [...params].every(([column, filter]) => RESERVED.has(column) || matches(candidate[column], filter)),
  );
  const limit = params.get('limit');
  return limit === null ? rows : rows.slice(0, Number(limit));
}

/** What the sweep asked, decoded so the `+` of a UTC offset reads as itself. */
function describeQuery(url) {
  const { searchParams } = new URL(url);
  return [...searchParams]
    .filter(([key]) => key !== 'select' && key !== 'order')
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

async function main() {
  const bundleDir = mkdtempSync(path.join(tmpdir(), 'alf221-worker-'));
  try {
    const bundle = path.join(bundleDir, 'sweep.mjs');
    await build({
      entryPoints: [fileURLToPath(new URL('../../../workers/src/comms/sweep.ts', import.meta.url))],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
      // A dependency of the classifier ships CommonJS; give the ESM bundle a real `require`.
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    const { runCommsSweep, COMMS_ABANDON_LIMIT } = await import(pathToFileURL(bundle).href);

    const scenarios = {
      before: { table: [STALLED()] },
      abandon: { table: [STALLED()] },
      worklist: { table: [STALLED()], refuseWrites: true },
      'no-tier': {
        table: [
          row({
            classify_attempts: 5,
            reclassify_requested_at: REQUESTED,
          }),
        ],
      },
      newer: { table: [STALLED()], askAgainDuringRead: true },
      'two-stalled': {
        ticks: 2,
        table: [
          row({ classify_attempts: 5, reclassify_requested_at: REQUESTED }),
          row({
            id: DANA_TWO,
            source_id: 'gmail-2',
            classify_attempts: 5,
            reclassify_requested_at: '2026-09-09T14:51:00.000000+00:00',
          }),
        ],
      },
    };
    const scenario = scenarios[section];
    if (scenario === undefined) throw new Error(`unknown section: ${section}`);
    const { table } = scenario;

    const log = [];
    let modelCalls = 0;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('anthropic.com')) {
        modelCalls += 1;
        return Promise.resolve(new Response('no live model in the demo', { status: 500 }));
      }
      if (url.includes('/rest/v1/comm_messages')) {
        const { searchParams } = new URL(url);
        if (method === 'PATCH' && scenario.refuseWrites === true) {
          log.push({ kind: 'refused', query: describeQuery(url) });
          return Promise.resolve(new Response('permission denied', { status: 403 }));
        }
        if (method === 'PATCH') {
          const body = JSON.parse(init.body);
          const hit = select(table, searchParams);
          log.push({ kind: 'write', query: describeQuery(url), body, matched: hit.length });
          for (const candidate of hit) Object.assign(candidate, body);
          return Promise.resolve(Response.json(hit.map((candidate) => ({ id: candidate.id }))));
        }
        const result = select(table, searchParams);
        log.push({ kind: 'read', query: describeQuery(url), returned: result.length });
        // The owner asks again the instant after the sweep has read the stalled request.
        if (scenario.askAgainDuringRead === true && searchParams.get('classify_attempts')?.startsWith('gte.')) {
          const snapshot = result.map((candidate) => ({ ...candidate }));
          for (const candidate of table) candidate.reclassify_requested_at = '2026-09-09T14:59:00+00:00';
          return Promise.resolve(Response.json(snapshot));
        }
        return Promise.resolve(Response.json(result));
      }
      // Everything else a tick with nothing to judge touches: the health stamp, accounts.
      return Promise.resolve(Response.json([]));
    };

    const env = {
      SUPABASE_URL: 'https://demo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'demo-service-role-key',
      ANTHROPIC_API_KEY: 'demo-key-nothing-is-sent-with-it',
      CLASSIFIER_MODEL: 'claude-haiku-4-5',
      CLASSIFIER_TIMEZONE: 'America/Chicago',
    };

    const show = (label, current) => {
      console.log(`${label}`);
      for (const candidate of current) {
        if (current.length > 1) console.log(`  row ${candidate.id.slice(-2)}`);
        console.log(`  tier                     ${candidate.tier ?? 'none'}`);
        console.log(`  judged_by                ${candidate.judged_by ?? 'none'}`);
        console.log(`  ask                      ${candidate.ask ?? 'none'}`);
        console.log(`  classify_attempts        ${String(candidate.classify_attempts)}`);
        console.log(`  reclassify_requested_at  ${candidate.reclassify_requested_at ?? 'none'}`);
        console.log(`  reclassify_failed_at     ${candidate.reclassify_failed_at ?? 'none'}`);
      }
    };

    show('the row before the sweep:', table);
    if (section === 'before') return;

    // The sweep logs to stderr; the demo prints what it did, so silence that here and say it below.
    const errors = [];
    console.error = (...args) => errors.push(args.map(String).join(' '));
    const ticks = scenario.ticks ?? 1;
    for (let tick = 1; tick <= ticks; tick += 1) {
      const at = new Date(NOW.getTime() + (tick - 1) * 2 * 60 * 1000);
      log.length = 0;
      errors.length = 0;
      const summary = await runCommsSweep(env, at);

      console.log('');
      console.log(
        ticks === 1
          ? `one sweep tick at ${at.toISOString()} (abandon cap per tick: ${String(COMMS_ABANDON_LIMIT)})`
          : `sweep tick ${String(tick)} of ${String(ticks)} at ${at.toISOString()} (abandon cap per tick: ${String(COMMS_ABANDON_LIMIT)})`,
      );
      for (const entry of log) {
        if (entry.kind === 'read') {
          console.log(`  read   ${entry.query}  -> ${String(entry.returned)} row(s)`);
        } else if (entry.kind === 'refused') {
          console.log(`  WRITE  ${entry.query}  -> refused by the database (403)`);
        } else {
          console.log(`  WRITE  ${entry.query}`);
          console.log(
            `         ${JSON.stringify(entry.body)}  -> ${String(entry.matched)} row(s) matched`,
          );
        }
      }
      console.log('');
      console.log(`model calls made: ${String(modelCalls)}`);
      console.log(`summary: ${JSON.stringify(summary)}`);
      for (const line of errors.filter((entry) => entry.includes('abandon'))) {
        console.log(`log: ${line.split(' Error: ')[0]}`);
      }
      console.log('');
      show(ticks === 1 ? 'the row after the sweep:' : `the rows after tick ${String(tick)}:`, table);
    }
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
}

await main();
