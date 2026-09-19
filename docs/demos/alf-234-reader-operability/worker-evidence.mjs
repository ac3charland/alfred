/**
 * The two Worker-side changes, driven through the REAL Worker code with a stubbed `fetch`.
 *
 * The Worker is a headless subsystem — its only surfaces are the HTTP calls it makes and the
 * lines it logs — so the evidence is those calls and those lines, captured from the production
 * modules rather than restated. `workers/src` imports are extensionless, so the entry points are
 * bundled with esbuild (already a dependency) into one throwaway ESM module first.
 *
 * Section 1 runs a whole five-minute tick (`runReaderTick`) against a stubbed Supabase and a
 * stubbed token mint: the reads answer empty so the loop has no work, and what is captured is the
 * ORDER of the tick's calls and the two `reader_health` PATCH bodies. Sections 2 to 4 fire the
 * daily retention cron at the Worker's real `scheduled` handler, so the RPCs and the log lines
 * below are the ones production emits.
 *
 * Run from the repo root: `node docs/demos/alf-234-reader-operability/worker-evidence.mjs`
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A deploy with every binding the tick checks before it runs: the two config vars, the model key,
 * and the three Gmail bindings. Any one of them missing is recorded by `recordRunError` BEFORE a
 * run start exists — which is the state section 1 is not about.
 */
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
  READER_MODEL: 'claude-sonnet-5',
  READER_DAILY_CAP: '30',
  ANTHROPIC_API_KEY: 'stub-anthropic-key',
  GMAIL_OAUTH_CLIENT_ID: 'stub-client-id',
  GMAIL_OAUTH_CLIENT_SECRET: 'stub-client-secret',
  GMAIL_PERSONAL_REFRESH_TOKEN: 'stub-refresh-token',
};
/**
 * The Worker's failure lines go to `console.error`, and Node flushes stdout and stderr
 * independently once the output is a pipe — so a captured run can interleave them differently
 * every time and `demo -- verify` would never settle. The log lines ARE the evidence here, so
 * both streams are funnelled onto stdout; the `reader:`/`comms:` prefix is what marks a failure
 * line either way.
 */
console.error = (...args) => {
  console.log(...args);
};

const NOW = new Date('2026-09-18T09:17:00.000Z');
const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined };

/** How many model calls the day had already spent when this tick counted them. */
const SPENT_TODAY = 24;

/** Bundle the Worker modules this script drives into one ESM file it can import. */
async function bundle(outDir) {
  const entry = path.join(outDir, 'entry.ts');
  const outfile = path.join(outDir, 'worker.mjs');
  await build({
    stdin: {
      contents: `export { runReaderTick } from '${process.cwd()}/workers/src/reader/scheduled.ts';
                 export { RETENTION_CRON, default as worker } from '${process.cwd()}/workers/src/index.ts';`,
      resolveDir: path.dirname(entry),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  return outfile;
}

/** A JSON body, the way PostgREST answers one. */
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Answer every read one tick makes, and record the requests in order.
 *
 * The ceiling count is the one that matters: `countRows` asks for `Prefer: count=exact` and reads
 * the TOTAL out of `Content-Range`, so this hands back a header saying 24 and an empty body. The
 * roster, discovery and worklist reads answer `[]`, which leaves the tick's loop with no work and
 * takes it straight to its terminal health write; the token mint answers the way Google does.
 */
function stubTick(calls) {
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method ?? 'GET';
    // `Prefer: count=exact` is what makes the ceiling count legible in the trace: the tick reads
    // `reader_posts` twice and only one of them is the count.
    const prefer = init.headers?.Prefer;
    calls.push({ method, path: target.pathname, body: init.body, prefer });

    if (target.host === 'oauth2.googleapis.com') {
      return json({ access_token: 'stub-access-token', expires_in: 3600 });
    }
    if (init.headers?.Prefer === 'count=exact') {
      return new Response('[]', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Content-Range': `0-0/${String(SPENT_TODAY)}`,
        },
      });
    }
    return json([]);
  };
}

/** The health row's PATCH body, with its keys in a fixed order so the output never churns. */
function ordered(body) {
  const parsed = JSON.parse(body);
  return Object.fromEntries(Object.keys(parsed).sort().map((key) => [key, parsed[key]]));
}

/** One tick's requests, as a numbered trace — what was asked for, and in what order. */
function printTrace(calls) {
  calls.forEach((call, index) => {
    const note = call.prefer === 'count=exact' ? '  (Prefer: count=exact — the ceiling count)' : '';
    console.log(`  ${String(index + 1)}. ${call.method} ${call.path}${note}`);
  });
}

async function main() {
  const outDir = mkdtempSync(path.join(tmpdir(), 'alfred-worker-demo-'));
  try {
    const worker = await import(await bundle(outDir));

    console.log('1 · One whole tick: what it reads, in what order, and what it stamps');
    const calls = [];
    stubTick(calls);
    const summary = await worker.runReaderTick(ENV, NOW);
    printTrace(calls);
    console.log(`  failures: ${JSON.stringify(summary.failures)}`);

    // The count is call 1 and the run-start stamp is call 2, which is the whole point: a start
    // stamp that moved `last_run_at` into a new day while the row still held the previous day's
    // count would describe a budget already spent. Both PATCHes therefore carry the WHOLE
    // ceiling — the first the spend as the tick found it, the last with its own calls added
    // (none here: the worklist was empty) — so the UI can say "(30)" without knowing a deploy var.
    const stamps = calls.filter(
      (call) => call.method === 'PATCH' && call.path.endsWith('/reader_health'),
    );
    console.log('\n  The reader_health writes, in order:');
    for (const stamp of stamps) {
      console.log(`    ${JSON.stringify(ordered(stamp.body))}`);
    }

    console.log(`\n2 · The daily retention cron (${worker.RETENTION_CRON}): comms, then the reader`);
    // 12 comms messages deleted, then the reader's batches: 2, 1, and 0 — the last one is how
    // the loop learns there is nothing left.
    const sweeps = [];
    const answers = [12, 2, 1, 0];
    globalThis.fetch = async (url, init) => {
      sweeps.push({ method: init.method, path: new URL(String(url)).pathname, body: init.body });
      return json(answers.shift() ?? 0);
    };
    await worker.worker.scheduled({ cron: worker.RETENTION_CRON }, ENV, CTX);
    for (const call of sweeps) {
      console.log(`  ${call.method} ${call.path}  ${call.body}`);
    }

    console.log('\n3 · A reader sweep that commits two batches and then breaks');
    // Each batch is its own transaction, so the two rows the first batch swept are durable. The
    // run reports that partial count BESIDE its failure rather than "did not run", which would
    // throw away a true number.
    let readerBatch = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('comm_sweep_expired')) return json(6);
      readerBatch += 1;
      return readerBatch === 1
        ? json(2)
        : new Response('canceling statement due to statement timeout', { status: 500 });
    };
    await worker.worker.scheduled({ cron: worker.RETENTION_CRON }, ENV, CTX);

    console.log('\n4 · A reader sweep that breaks before any batch commits');
    // Nothing committed, so there is no count to report and the line is "did not run" — and the
    // comms sweep beside it still ran, because each unit owns its own try/catch.
    let answered = false;
    globalThis.fetch = async (url) => {
      if (!answered && String(url).includes('comm_sweep_expired')) {
        answered = true;
        return json(4);
      }
      return new Response('nope', { status: 500 });
    };
    await worker.worker.scheduled({ cron: worker.RETENTION_CRON }, ENV, CTX);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
