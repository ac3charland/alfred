/**
 * The Telegram pings demo harness. One section per invocation:
 *
 *   node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts <section>
 *
 *   render   both pings as the Worker builds them (format.ts), plus one full of markup and emoji
 *   windows  claim_notifications on a throwaway PostgreSQL with every migration applied: a minute
 *            of ticks around a 3:00 PM task and a fresh ASAP verdict, then a reschedule
 *   tick     the shipped runNotifyTick end to end (claim, send, record) through every outcome
 *   live     one real sendTelegram against api.telegram.org with an obviously fake token
 *
 * WHAT IS REAL AND WHAT IS STOOD UP LOCALLY
 *
 *   real   format.ts, telegram.ts, tick.ts, store.ts and claim_notifications, unmodified, on a
 *          throwaway PostgreSQL carrying every migration.
 *   local  `windows` marks each claim sent by hand, where the Worker would after Telegram accepted
 *          it. `tick` swaps the global fetch: Supabase REST calls become the same SQL against that
 *          database (the RPC call, and the PATCH of one notifications row), and each Telegram send
 *          is answered from a script (200, 400, 502, 429, 401), since no real chat is reachable.
 */
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';
import { buildCommsAsap, buildTaskDue } from '../../../workers/src/notify/format';
import { runNotifyTick } from '../../../workers/src/notify/tick';
import { sendTelegram } from '../../../workers/src/telegram';

const APP = 'https://alfred-six-gamma.vercel.app';

function render(): void {
  const asap = buildCommsAsap(
    { sender: 'Dana', account: 'iMessage', ask: 'Asks whether you can pick up the kids at 4 today.' },
    APP,
  );
  const due = buildTaskDue({ title: 'Call the dentist about the crown', dueTime: '15:00:00' }, APP);
  const hostile = buildCommsAsap(
    { sender: 'A&B <Co>', account: 'Gmail', ask: `Is <b>this</b> > that? 🎉 ${'x'.repeat(400)}` },
    APP,
  );
  for (const [name, text] of [
    ['comms_asap', asap],
    ['task_due', due],
    ['comms_asap with markup, emoji and a 400+ char ask', hostile],
  ] as const) {
    console.log(`── ${name} — HTML sent to Telegram`);
    console.log(text.html);
    console.log(`── ${name} — plain-text fallback`);
    console.log(text.plain);
    console.log();
  }
}

/** A Chicago wall-clock time on 2031-01-15 (CST, UTC−6) as an ISO instant. */
const cst = (time: string): string => new Date(`2031-01-15T${time}:00-06:00`).toISOString();

async function windows(): Promise<void> {
  const cluster = await startCluster();
  const db = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  try {
    await db.connect();
    await bootstrapSupabase(db);
    await applyMigrations(db);

    const task = async (title: string, time: string | null, status = 'active'): Promise<string> => {
      const { rows } = await db.query<{ id: string }>(
        `insert into items (title, item_type, due_date, due_time, status, completed_at)
           values ($1, 'task', '2031-01-15T00:00:00Z', $2::time, $3::item_status,
                   case when $3 = 'completed' then now() end)
           returning id`,
        [title, time, status],
      );
      return rows[0]?.id ?? '';
    };
    const dentist = await task('Call the dentist about the crown', '15:00');
    await task('Pick up dry cleaning', '14:30');
    await task('Renew passport (date only)', null);
    await task('Pay rent (completed)', '15:00', 'completed');

    const { rows: accounts } = await db.query<{ id: string }>(
      `insert into comm_accounts (key, kind, label, home)
         values ('imessage', 'imessage', 'iMessage', 'daemon') returning id`,
    );
    const account = accounts[0]?.id;
    const message = async (sender: string, ask: string, at: string, judgedBy: string) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into comm_messages (account_id, source_id, thread_key, sender_handle, sender_name,
                                    received_at, tier, judged_by)
           values ($1, $2, $2, $2, $3, $4, 'asap', $5) returning id`,
        [account, `${sender}@example.com`, sender, at, judgedBy],
      );
      const id = rows[0]?.id;
      const { rows: verdicts } = await db.query<{ id: string }>(
        `insert into comm_verdicts (message_id, tier, owes_reply, ask, reason, provider, model,
                                    prompt_version, rubric_version, example_set_version, created_at)
           values ($1, 'asap', true, $2, 'r', 'anthropic', 'm', 1, 1, 1, $3) returning id`,
        [id, ask, at],
      );
      await db.query(`update comm_messages set verdict_id = $2 where id = $1`, [id, verdicts[0]?.id]);
    };
    await message('Dana', 'Asks whether you can pick up the kids at 4 today.', cst('14:58'), 'model');
    await message('Sam', 'Wants the report by noon (judged an hour ago).', cst('14:00'), 'model');
    await message('Lee', 'You moved this to ASAP yourself.', cst('14:58'), 'owner');

    console.log('Seeded (Chicago time, 2031-01-15):');
    console.log('  tasks     Call the dentist 3:00 PM · Pick up dry cleaning 2:30 PM ·');
    console.log('            Renew passport (date only) · Pay rent 3:00 PM (completed)');
    console.log('  messages  Dana ASAP, model, judged 2:58 PM · Sam ASAP, model, judged 2:00 PM ·');
    console.log('            Lee ASAP, set by the owner');
    console.log();

    const tick = async (time: string): Promise<void> => {
      const { rows } = await db.query<{ id: string; kind: string; label: string }>(
        `select id, kind, coalesce(sender || ' — ' || ask, title || ' @ ' || to_char(due_time, 'HH24:MI')) as label
           from claim_notifications($1::timestamptz, 'America/Chicago', 20)`,
        [cst(time)],
      );
      const claimed = rows.map((row) => `${row.kind}: ${row.label}`);
      console.log(`tick ${time} → ${claimed.length === 0 ? 'nothing' : claimed.join('; ')}`);
      for (const row of rows) {
        await db.query(
          `update notifications set sent_at = now(), telegram_message_id = 1, text = 'sent' where id = $1`,
          [row.id],
        );
      }
    };

    await tick('14:59');
    await tick('15:00');
    await tick('15:01');
    console.log();
    console.log('The dentist moves to 3:20 PM:');
    await db.query(`update items set due_time = '15:20' where id = $1`, [dentist]);
    await tick('15:19');
    await tick('15:20');
    await tick('15:21');

    const { rows } = await db.query<{ kind: string; fire_key: string }>(
      `select kind, regexp_replace(fire_key, '^[0-9a-f-]{36}', '<id>') as fire_key
         from notifications order by claimed_at, kind`,
    );
    console.log();
    console.log('notifications rows (one per ping):');
    for (const row of rows) console.log(`  ${row.kind.padEnd(10)} ${row.fire_key}`);
  } finally {
    await db.end();
    cluster.stop();
  }
}

/** A throwaway cluster with every migration applied, handed to `fn` and torn down after. */
async function withDatabase(fn: (db: pg.Client) => Promise<void>): Promise<void> {
  const cluster = await startCluster();
  const db = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });
  try {
    await db.connect();
    await bootstrapSupabase(db);
    await applyMigrations(db);
    await fn(db);
  } finally {
    await db.end();
    cluster.stop();
  }
}

type Scripted = { status: number; body: Record<string, unknown> };

const scripted = (status: number, extra: Record<string, unknown> = {}): Scripted => ({
  status,
  body: { ok: status === 200, description: status === 200 ? undefined : 'scripted', ...extra },
});

async function tick(): Promise<void> {
  await withDatabase(async (db) => {
    // One minute apart, so the claim order (oldest due moment first) is fixed.
    const tasks = [
      ['Call the dentist', '14:56'],
      ['Book flights', '14:57'],
      ['Water the plants', '14:58'],
      ['Pay the sitter', '14:59'],
      ['Email Sam', '15:00'],
    ];
    for (const [title, time] of tasks) {
      await db.query(
        `insert into items (title, item_type, due_date, due_time)
           values ($1, 'task', '2031-01-15T00:00:00Z', $2::time)`,
        [title, time],
      );
    }

    // Each Telegram send takes the next scripted reply; Supabase REST becomes the same SQL.
    let script: Scripted[] = [];
    let messageId = 500;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const body = JSON.parse((init?.body as string | undefined) ?? '{}') as Record<string, unknown>;
      if (url.hostname === 'api.telegram.org') {
        const reply = script.shift() ?? scripted(200);
        if (reply.status === 200) {
          messageId += 1;
          reply.body = { ok: true, result: { message_id: messageId } };
        }
        const mode = body['parse_mode'] === undefined ? 'plain' : 'HTML';
        console.log(`  telegram <- ${mode.padEnd(5)} -> ${String(reply.status)}`);
        return Response.json(reply.body, { status: reply.status });
      }
      if (url.pathname === '/rest/v1/rpc/claim_notifications') {
        const { rows } = await db.query(
          `select * from claim_notifications($1::timestamptz, $2, $3)`,
          [body['p_now'], body['p_zone'], body['p_limit']],
        );
        return Response.json(rows);
      }
      if (url.pathname === '/rest/v1/notifications' && init?.method === 'PATCH') {
        const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
        const columns = Object.keys(body);
        const sets = columns.map((column, index) => `${column} = $${String(index + 2)}`);
        await db.query(`update notifications set ${sets.join(', ')} where id = $1`, [
          id,
          ...columns.map((column) => body[column]),
        ]);
        return Response.json([{}]);
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    }) as typeof fetch;

    const env = {
      SUPABASE_URL: 'https://demo.supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'demo',
      TELEGRAM_BOT_TOKEN: '123456:not-a-real-token',
      TELEGRAM_CHAT_ID: '1',
      ALFRED_APP_URL: APP,
      CLASSIFIER_TIMEZONE: 'America/Chicago',
    };
    const show = async (label: string, at: string): Promise<void> => {
      console.log(label);
      const { failures, ...counts } = await runNotifyTick(env, new Date(cst(at)));
      console.log(`  summary ${JSON.stringify(counts)}`);
      for (const failure of failures) {
        console.log(`  failure ${failure.replace(/[0-9a-f-]{36}/, '<id>')}`);
      }
      const { rows } = await db.query<Record<string, unknown>>(
        `select t.title, n.sent_at is not null as sent, n.attempts, n.last_error,
                split_part(n.text, chr(10), 1) as headline
           from notifications n join items t on t.id = n.item_id order by t.due_time, t.title`,
      );
      for (const row of rows) {
        console.log(
          `  row  ${String(row['title']).padEnd(17)} sent=${String(row['sent']).padEnd(5)} ` +
            `attempts=${String(row['attempts'])} error=${String(row['last_error'] ?? '-')} ` +
            `text=${String(row['headline'] ?? '-')}`,
        );
      }
      console.log();
    };

    console.log('Five tasks due 2:56 to 3:00 PM Chicago, one a minute.\n');
    script = [
      scripted(200),
      scripted(400),
      scripted(200),
      scripted(502),
      scripted(429, { parameters: { retry_after: 3 } }),
    ];
    await show('tick 3:00 PM: 200; 400 then the plain resend 200; 502; 429 stops the tick', '15:00');
    script = [];
    await show('tick 3:01 PM: the leftovers are leased to the last tick for five minutes', '15:01');
    script = [scripted(200), scripted(200), scripted(200)];
    await show('tick 3:05 PM: the 502, the 429 and the never-tried claim are retried', '15:05');

    await db.query(
      `insert into items (title, item_type, due_date, due_time)
         values ('Feed the cat', 'task', '2031-01-15T00:00:00Z', '15:06')`,
    );
    script = [scripted(401)];
    await show('tick 3:06 PM: a 401 aborts the tick and counts nothing', '15:06');

    const { TELEGRAM_BOT_TOKEN: _unset, ...unconfigured } = env;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json([]);
    }) as typeof fetch;
    console.log('tick with TELEGRAM_BOT_TOKEN unset:');
    const summary = await runNotifyTick(unconfigured, new Date(cst('15:07')));
    console.log(`  summary ${JSON.stringify(summary)} · requests made: ${String(requests)}`);
    globalThis.fetch = realFetch;
  });
}

async function live(): Promise<void> {
  // Obviously fake, and far too short to be mistaken for (or flagged as) a real token.
  const result = await sendTelegram(
    { TELEGRAM_BOT_TOKEN: '123456:not-a-real-token', TELEGRAM_CHAT_ID: '1' },
    '<b>demo</b>',
    'demo',
  );
  console.log(JSON.stringify(result));
}

const section = process.argv[2];
if (section === 'render') render();
else if (section === 'windows') await windows();
else if (section === 'tick') await tick();
else if (section === 'live') await live();
else {
  console.error('usage: harness.ts render|windows|tick|live');
  process.exitCode = 2;
}
