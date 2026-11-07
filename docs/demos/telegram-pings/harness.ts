/**
 * The Telegram pings demo harness. One section per invocation:
 *
 *   node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts <section>
 *
 *   render   both pings as the Worker builds them (format.ts), plus one full of markup and emoji
 *   windows  claim_notifications on a throwaway PostgreSQL with every migration applied: a minute
 *            of ticks around a 3:00 PM task and a fresh ASAP verdict, then a reschedule
 *   live     one real sendTelegram against api.telegram.org with an obviously fake token
 *
 * Everything is the shipped code; nothing is mocked. The `windows` section marks each claim sent
 * by hand where the Worker would, after Telegram accepted it.
 */
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';
import { buildCommsAsap, buildTaskDue } from '../../../workers/src/notify/format';
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
else if (section === 'live') await live();
else {
  console.error('usage: harness.ts render|windows|live');
  process.exitCode = 2;
}
