/**
 * The ALF-345 demo harness: the morning digest when Telegram shows a message but its reply never
 * reaches the Worker.
 *
 *   node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-duplicate-digest/harness.ts
 *
 * WHAT IS REAL AND WHAT IS STOOD UP LOCALLY
 *
 *   real   tick.ts, store.ts, telegram.ts, the digest's compose path, claim_notifications and
 *          digest_facts, unmodified, on a throwaway PostgreSQL carrying every migration.
 *   local  the global fetch: Supabase REST calls become the same SQL against that database, and
 *          api.telegram.org is a stand-in "phone". Its first send is shown on the phone and then
 *          its reply hangs until the Worker's own 30 s abort fires; every later send answers
 *          200. No ANTHROPIC_API_KEY is set, so the digest goes out without its model opener.
 */
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';
import { runNotifyTick } from '../../../workers/src/notify/tick';

/** A Chicago wall-clock time on 2031-01-15 (CST, UTC−6) as an ISO instant. */
const cst = (time: string): string => new Date(`2031-01-15T${time}:00-06:00`).toISOString();

async function main(): Promise<void> {
  const cluster = await startCluster();
  const db = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  const realSetTimeout = globalThis.setTimeout;
  try {
    await db.connect();
    await bootstrapSupabase(db);
    await applyMigrations(db);
    await db.query(
      `insert into items (title, item_type, due_date, due_time)
         values ('Call the dentist', 'task', '2031-01-15T00:00:00Z', '07:11'::time)`,
    );

    // The phone: every message Telegram showed, whatever the Worker heard back.
    const phone: string[] = [];
    let hangNext = true;
    let messageId = 4;
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as Record<string, unknown>;
      if (url.hostname === 'api.telegram.org') {
        messageId += 1;
        const headline = String(body['text']).split('\n')[0]?.replace(/<[^>]+>/g, '');
        phone.push(`#${String(messageId)} ${headline ?? ''}`);
        if (hangNext) {
          hangNext = false;
          // Shown, but the reply never comes: wait for the Worker's own abort signal.
          const signal = init?.signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(signal.reason as Error);
            });
          });
        }
        return Response.json({ ok: true, result: { message_id: messageId } });
      }
      if (url.pathname === '/rest/v1/rpc/claim_notifications') {
        const { rows } = await db.query(
          `select * from claim_notifications($1::timestamptz, $2, $3, $4::time)`,
          [body['p_now'], body['p_zone'], body['p_limit'], body['p_digest_time'] ?? null],
        );
        return Response.json(rows);
      }
      if (url.pathname === '/rest/v1/rpc/digest_facts') {
        const { rows } = await db.query<{ facts: unknown }>(
          `select digest_facts($1::timestamptz, $2) as facts`,
          [body['p_now'], body['p_zone']],
        );
        return Response.json(rows[0]?.facts);
      }
      if (url.pathname === '/rest/v1/notifications' && init?.method === 'PATCH') {
        const filter = url.searchParams.get('id') ?? '';
        const ids = filter.startsWith('in.(') ? filter.slice(4, -1).split(',') : [filter.slice(3)];
        const columns = Object.keys(body);
        const sets = columns.map((column, index) => `${column} = $${String(index + 2)}`);
        await db.query(`update notifications set ${sets.join(', ')} where id = any($1::uuid[])`, [
          ids,
          ...columns.map((column) => body[column]),
        ]);
        return Response.json([{}]);
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    }) as typeof fetch;

    // The 30 s abort runs on a real timer; let it fire at once so the demo doesn't wait.
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    console.warn = () => undefined;

    const env = {
      SUPABASE_URL: 'https://demo.supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'demo',
      TELEGRAM_BOT_TOKEN: '123456:not-a-real-token',
      TELEGRAM_CHAT_ID: '1',
      ALFRED_APP_URL: 'https://alfred-six-gamma.vercel.app',
      CLASSIFIER_TIMEZONE: 'America/Chicago',
      DIGEST_TIME: '07:10',
    };

    for (const [time, label] of [
      ['07:10', 'Telegram shows the digest, but its reply never arrives'],
      ['07:11', 'Telegram is answering again; the task due at 7:11 is claimed'],
      ['07:16', 'the digest’s five-minute lease has run out'],
    ] as const) {
      const before = phone.length;
      const { failures, ...counts } = await runNotifyTick(env, new Date(cst(time)));
      console.log(`tick ${time} — ${label}`);
      console.log(`  summary ${JSON.stringify(counts)}`);
      for (const failure of failures) {
        console.log(`  failure ${failure.replace(/[0-9a-f-]{36}/, '<id>')}`);
      }
      const shown = phone.slice(before);
      console.log(`  phone   ${shown.length === 0 ? '(nothing new)' : shown.join(' · ')}`);
      const { rows } = await db.query<Record<string, unknown>>(
        `select kind, attempts, last_error, sent_at is not null as sent,
                abandoned_at is not null as abandoned, leased_at is not null as leased
           from notifications order by kind`,
      );
      for (const row of rows) {
        console.log(
          `  row     ${String(row['kind']).padEnd(14)} attempts=${String(row['attempts'])} ` +
            `sent=${String(row['sent']).padEnd(5)} leased=${String(row['leased']).padEnd(5)} ` +
            `abandoned=${String(row['abandoned']).padEnd(5)} error=${String(row['last_error'] ?? '-')}`,
        );
      }
      console.log();
    }
    console.log(`The phone, all morning: ${String(phone.length)} messages`);
    for (const line of phone) console.log(`  ${line}`);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await db.end();
    cluster.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
