/**
 * The two Worker-side changes, driven through the REAL Worker code with a stubbed `fetch`.
 *
 * The Worker is a headless subsystem — its only surfaces are the HTTP calls it makes and the
 * lines it logs — so the evidence is those calls and those lines, captured from the production
 * modules rather than restated. `workers/src` imports are extensionless, so the two entry points
 * are bundled with esbuild (already a dependency) into one throwaway ESM module first.
 *
 * Section 1 — the ceiling stamp: what `recordRunStart` / `recordRunSuccess` now PATCH onto
 * `reader_health`, which is what lets the UI say "(30)" without knowing the deploy var.
 * Sections 2 and 3 fire the daily retention cron at the Worker's real `scheduled` handler, so
 * the RPCs and the log lines below are the ones production emits, not a restatement of them.
 *
 * Run from the repo root: `node docs/demos/alf-234-reader-operability/worker-evidence.mjs`
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'stub-key' };
const NOW = new Date('2026-09-18T09:17:00.000Z');
const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined };

/** Bundle the Worker modules this script drives into one ESM file it can import. */
async function bundle(outDir) {
  const entry = path.join(outDir, 'entry.ts');
  const outfile = path.join(outDir, 'worker.mjs');
  await build({
    stdin: {
      contents: `export { recordRunStart, recordRunSuccess } from '${process.cwd()}/workers/src/reader/health.ts';
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

/** Record every request the Worker makes, and answer each one the way Supabase would. */
function stubFetch(answers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    calls.push({ method: init.method, path: target.pathname, body: init.body });
    return new Response(JSON.stringify(answers.shift() ?? null), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return calls;
}

/** The health row's PATCH body, with its keys in a fixed order so the output never churns. */
function ordered(body) {
  const parsed = JSON.parse(body);
  return Object.fromEntries(Object.keys(parsed).sort().map((key) => [key, parsed[key]]));
}

async function main() {
  const outDir = mkdtempSync(path.join(tmpdir(), 'alfred-worker-demo-'));
  try {
    const worker = await import(await bundle(outDir));

    console.log('1 · The ceiling the tick stamps on reader_health');
    const stamps = stubFetch([{}, {}]);
    // The tick counts the day's model calls BEFORE it stamps the run's start, so BOTH writes
    // carry the whole ceiling: the first with the spend as the tick found it, the last with its
    // own calls added. A start stamp that moved `last_run_at` into a new day while the row still
    // held the previous day's count would read as a budget already spent.
    await worker.recordRunStart(ENV, NOW, {
      daily_cap: 30,
      calls_today: 24,
      calls_day: '2026-09-18',
    });
    await worker.recordRunSuccess(ENV, NOW, {
      daily_cap: 30,
      calls_today: 30,
      calls_day: '2026-09-18',
    });
    for (const call of stamps) {
      console.log(`  ${call.method} ${call.path}`);
      console.log(`    ${JSON.stringify(ordered(call.body))}`);
    }

    console.log(`\n2 · The daily retention cron (${worker.RETENTION_CRON}): comms, then the reader`);
    // 12 comms messages deleted, then the reader's batches: 2, 1, and 0 — the last one is how
    // the loop learns there is nothing left.
    const sweeps = stubFetch([12, 2, 1, 0]);
    await worker.worker.scheduled({ cron: worker.RETENTION_CRON }, ENV, CTX);
    for (const call of sweeps) {
      console.log(`  ${call.method} ${call.path}  ${call.body}`);
    }

    console.log('\n3 · The reader sweep failing does not take the comms sweep with it');
    // The comms RPC answers; every reader batch is refused.
    let answered = false;
    globalThis.fetch = async (url) => {
      if (!answered && String(url).includes('comm_sweep_expired')) {
        answered = true;
        return new Response('4', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('nope', { status: 500 });
    };
    await worker.worker.scheduled({ cron: worker.RETENTION_CRON }, ENV, CTX);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
