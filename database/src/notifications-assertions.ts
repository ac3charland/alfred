import pg, { type Client } from 'pg';

import { type AssertionResult, attempt } from './assertions.ts';

/**
 * The SQL half of the Telegram pings (ALF-333): what `claim_notifications` claims, what it never
 * claims, how a claim is retried or abandoned, and what deleting a subject takes with it. Every
 * eligibility rule lives in the RPC, so this is where each one is pinned.
 *
 * Each check runs at its own instant, a day after the last, far from the wall clock: the rest of
 * the suite writes verdicts and tasks at `now()`, and none of them may land in a window here.
 */

const ZONE = 'America/Chicago';

interface Claim {
  id: string;
  kind: string;
  attempts: number;
  sender: string | null;
  account: string | null;
  ask: string | null;
  title: string | null;
  due_time: string | null;
}

/** A rejection handler for a failure the check expects or does not care about. */
function ignore(): undefined {
  return;
}

let dayCounter = 0;

/** A fresh UTC midnight for one check, strictly after every earlier check's. */
function nextDay(): Date {
  dayCounter += 1;
  return new Date(Date.UTC(2031, 0, 1 + dayCounter));
}

/** `base` plus `minutes`, as an ISO instant. */
function at(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

/** The `YYYY-MM-DD` of a UTC instant. */
function ymd(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

async function asRole<T>(client: Client, role: string, fn: () => Promise<T>): Promise<T> {
  await client.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await client.query('reset role');
  }
}

/** Call the RPC as the Worker does — as `service_role`. */
async function claim(
  client: Client,
  now: string,
  options: { zone?: string; limit?: number } = {},
): Promise<Claim[]> {
  const { rows } = await asRole(client, 'service_role', () =>
    client.query<Claim>(`select * from claim_notifications($1::timestamptz, $2, $3)`, [
      now,
      options.zone ?? ZONE,
      options.limit ?? 20,
    ]),
  );
  return rows;
}

/** Start a check from an empty table, so no earlier check's claims are retried into it. */
async function reset(client: Client): Promise<void> {
  await client.query('delete from notifications');
}

let accountCounter = 0;

async function account(client: Client, label = 'iMessage'): Promise<string> {
  accountCounter += 1;
  const { rows } = await client.query<{ id: string }>(
    `insert into comm_accounts (key, kind, label, home)
       values ($1, 'imessage', $2, 'daemon') returning id`,
    [`notify-${String(accountCounter)}`, label],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no account inserted');
  return id;
}

interface MessageOptions {
  verdictAt: string;
  tier?: string;
  judgedBy?: string;
  direction?: string;
  cleared?: boolean;
  senderName?: string;
  /** The sender has no display name, only a handle. */
  noName?: boolean;
  senderHandle?: string;
  personName?: string;
  ask?: string;
  accountLabel?: string;
}

let messageCounter = 0;

/** A mirrored message plus the verdict its tier came from, the way the judge writes them. */
async function message(client: Client, options: MessageOptions): Promise<string> {
  messageCounter += 1;
  const accountId = await account(client, options.accountLabel);
  const tier = options.tier ?? 'asap';
  const { rows } = await client.query<{ id: string }>(
    `insert into comm_messages (account_id, source_id, thread_key, sender_handle, sender_name,
                                received_at, direction, tier, judged_by, cleared_at, cleared_by)
       values ($1, $2, $2, $3, $4, $5, $6, $7::comm_tier, $8,
               case when $9 then now() end, case when $9 then 'reply' end)
       returning id`,
    [
      accountId,
      `notify-msg-${String(messageCounter)}`,
      options.senderHandle ?? 'dana@example.com',
      options.noName === true ? undefined : (options.senderName ?? 'Dana S.'),
      options.verdictAt,
      options.direction ?? 'inbound',
      tier,
      options.judgedBy ?? 'model',
      options.cleared ?? false,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no message inserted');
  await verdict(client, id, {
    tier,
    at: options.verdictAt,
    ask: options.ask ?? 'Asks whether you can pick up the kids at 4 today.',
    ...(options.personName === undefined ? {} : { personName: options.personName }),
  });
  return id;
}

/** Write a verdict and point the message's tier at it — a judge run or a re-run. */
async function verdict(
  client: Client,
  messageId: string,
  options: { tier: string; at: string; ask?: string; personName?: string },
): Promise<void> {
  let personId: string | undefined;
  if (options.personName !== undefined) {
    const { rows } = await client.query<{ id: string }>(
      `insert into comm_people (name) values ($1) returning id`,
      [options.personName],
    );
    personId = rows[0]?.id;
  }
  const { rows } = await client.query<{ id: string }>(
    `insert into comm_verdicts (message_id, tier, owes_reply, ask, reason, provider, model,
                                prompt_version, rubric_version, example_set_version, person_id,
                                created_at)
       values ($1, $2::comm_tier, true, $3, 'r', 'anthropic', 'm', 1, 1, 1, $4, $5)
       returning id`,
    [messageId, options.tier, options.ask ?? 'An ask.', personId, options.at],
  );
  await client.query(
    `update comm_messages set verdict_id = $2, tier = $3::comm_tier, judged_by = 'model'
      where id = $1`,
    [messageId, rows[0]?.id, options.tier],
  );
}

/** An active task due on `date` at `time` (or date-only when `time` is undefined). */
async function task(
  client: Client,
  date: string,
  time?: string,
  title = 'Call the dentist about the crown',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into items (title, item_type, due_date, due_time)
       values ($1, 'task', ($2 || 'T00:00:00Z')::timestamptz, $3::time) returning id`,
    [title, date, time],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no task inserted');
  return id;
}

/** Stamp a claim as sent, the way the Worker does after Telegram accepts it. */
async function markSent(client: Client, id: string): Promise<void> {
  await client.query(
    `update notifications set sent_at = now(), telegram_message_id = 1, text = 'sent' where id = $1`,
    [id],
  );
}

async function rowsFor(
  client: Client,
  column: 'comm_message_id' | 'item_id',
  id: string,
): Promise<{ fire_key: string; abandoned_at: string | null; sent_at: string | null }[]> {
  const { rows } = await client.query<{
    fire_key: string;
    abandoned_at: string | null;
    sent_at: string | null;
  }>(`select fire_key, abandoned_at, sent_at from notifications where ${column} = $1`, [id]);
  return rows;
}

function expectIds(claims: Claim[], expected: string[], what: string): void {
  const got = claims.map((row) => row.id);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
}

function expectCount(claims: Claim[], count: number, what: string): void {
  if (claims.length !== count) {
    throw new Error(`${what}: expected ${String(count)} claims, got ${JSON.stringify(claims)}`);
  }
}

/** A Chicago wall-clock instant on `date` as UTC — winter (CST, UTC−6) for every January day. */
function chicago(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-06:00`);
}

export async function runNotificationAssertions(client: Client): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [
    await attempt(
      'a fresh model ASAP verdict claims one comms ping with sender, account and ask',
      async () => {
        await reset(client);
        const now = nextDay();
        const id = await message(client, {
          verdictAt: at(now, -5),
          personName: 'Dana',
          accountLabel: 'iMessage',
        });
        const claims = await claim(client, now.toISOString());
        expectCount(claims, 1, 'first tick');
        const [row] = claims;
        if (
          row?.kind !== 'comms_asap' ||
          row.sender !== 'Dana' ||
          row.account !== 'iMessage' ||
          row.ask !== 'Asks whether you can pick up the kids at 4 today.' ||
          row.attempts !== 0
        ) {
          throw new Error(`wrong claim: ${JSON.stringify(row)}`);
        }
        const keys = await rowsFor(client, 'comm_message_id', id);
        if (keys.length !== 1 || keys[0]?.fire_key !== id) {
          throw new Error(`fire_key should be the message id: ${JSON.stringify(keys)}`);
        }
        return 'one claim, keyed on the message, carrying sender + account + ask';
      },
    ),
    await attempt('the sender falls back from the person to the name to the handle', async () => {
      await reset(client);
      const now = nextDay();
      await message(client, { verdictAt: at(now, -3), senderName: 'Dana S.' });
      await message(client, {
        verdictAt: at(now, -2),
        noName: true,
        senderHandle: '+15551234567',
      });
      const claims = await claim(client, now.toISOString());
      const senders = claims.map((row) => row.sender);
      if (JSON.stringify(senders) !== JSON.stringify(['Dana S.', '+15551234567'])) {
        throw new Error(`senders: ${JSON.stringify(senders)}`);
      }
      return 'sender_name, then sender_handle, oldest verdict first';
    }),
    await attempt(
      'no comms ping for an owner ASAP, a stale verdict, a cleared or outbound row, or another tier',
      async () => {
        await reset(client);
        const now = nextDay();
        await message(client, { verdictAt: at(now, -5), judgedBy: 'owner' });
        await client.query(
          `update comm_messages set judged_by = 'owner'
            where id = (select message_id from comm_verdicts where created_at = $1 limit 1)`,
          [at(now, -5)],
        );
        await message(client, { verdictAt: at(now, -31) });
        await message(client, { verdictAt: at(now, -30) });
        await message(client, { verdictAt: at(now, -4), cleared: true });
        await message(client, { verdictAt: at(now, -3), direction: 'outbound' });
        await message(client, { verdictAt: at(now, -2), tier: 'today' });
        expectCount(await claim(client, now.toISOString()), 0, 'every excluded row');
        return 'owner-set, 30+ minutes old, cleared, outbound and non-ASAP rows never claim';
      },
    ),
    await attempt(
      'ASAP → ASAP never re-pings; Today → ASAP pings once on the fresh verdict',
      async () => {
        await reset(client);
        const now = nextDay();
        const asap = await message(client, { verdictAt: at(now, -10) });
        const today = await message(client, { verdictAt: at(now, -60), tier: 'today' });
        const first = await claim(client, now.toISOString());
        expectCount(first, 1, 'first tick');
        for (const row of first) await markSent(client, row.id);

        await verdict(client, asap, { tier: 'asap', at: at(now, 1) });
        await verdict(client, today, { tier: 'asap', at: at(now, 1) });
        const second = await claim(client, at(now, 2));
        expectCount(second, 1, 'the re-run tick');
        for (const row of second) await markSent(client, row.id);
        const keys = await rowsFor(client, 'comm_message_id', today);
        if (keys.length !== 1) throw new Error('Today → ASAP did not claim');
        expectCount(await claim(client, at(now, 3)), 0, 'the next tick');
        const asapRows = await rowsFor(client, 'comm_message_id', asap);
        if (asapRows.length !== 1) {
          throw new Error('ASAP → ASAP claimed a second row');
        }
        return 'one row per message, however often it is re-judged';
      },
    ),
    await attempt(
      'a timed task claims at its due minute in the zone, and never more than 15 minutes late',
      async () => {
        await reset(client);
        const now = nextDay();
        const date = ymd(now);
        const id = await task(client, date, '15:00');
        const due = chicago(date, '15:00');

        expectCount(await claim(client, at(due, -1)), 0, 'a minute early');
        const claims = await claim(client, due.toISOString());
        expectCount(claims, 1, 'the due minute');
        const [row] = claims;
        if (
          row?.kind !== 'task_due' ||
          row.title !== 'Call the dentist about the crown' ||
          row.due_time !== '15:00:00'
        ) {
          throw new Error(`wrong claim: ${JSON.stringify(row)}`);
        }
        const keys = await rowsFor(client, 'item_id', id);
        if (keys[0]?.fire_key !== `${id}|${date}|15:00`) {
          throw new Error(`fire_key: ${JSON.stringify(keys)}`);
        }

        await reset(client);
        expectCount(await claim(client, at(due, 14)), 1, '14 minutes late');
        await reset(client);
        expectCount(await claim(client, at(due, 15)), 0, '15 minutes late');
        return 'claimed in (due − 15 min, due], read as Chicago wall-clock';
      },
    ),
    await attempt('a 23:30 Chicago time pings on the next UTC day, at 23:30 Chicago', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      await task(client, date, '23:30');
      expectCount(await claim(client, `${date}T23:30:00Z`), 0, '23:30 UTC');
      const due = chicago(date, '23:30');
      if (ymd(due) === date) throw new Error('fixture should cross the UTC day');
      expectCount(await claim(client, due.toISOString()), 1, '23:30 Chicago');
      return `due ${due.toISOString()}`;
    }),
    await attempt('a date-only task and a completed task never claim', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      await task(client, date);
      const done = await task(client, date, '09:00');
      await client.query(
        `update items set status = 'completed', completed_at = now() where id = $1`,
        [done],
      );
      for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
        expectCount(
          await claim(client, at(chicago(date, '00:00'), minutes)),
          0,
          `at +${String(minutes)}m`,
        );
      }
      return 'no claim at any minute of the day';
    }),
    await attempt(
      'rescheduling a pinged task re-arms it; moving 3:00 → 2:50 at 2:58 pings once, for 2:50',
      async () => {
        await reset(client);
        const now = nextDay();
        const date = ymd(now);
        const id = await task(client, date, '15:00');
        const pinged = await claim(client, chicago(date, '15:00').toISOString());
        for (const row of pinged) await markSent(client, row.id);
        await client.query(`update items set due_time = '16:00' where id = $1`, [id]);
        expectCount(await claim(client, chicago(date, '16:00').toISOString()), 1, 'the new time');

        const moved = await task(client, date, '20:00');
        await client.query(`update items set due_time = '19:50' where id = $1`, [moved]);
        const early = await claim(client, chicago(date, '19:58').toISOString());
        expectCount(early, 1, 'at 7:58 for 7:50');
        for (const row of early) await markSent(client, row.id);
        expectCount(await claim(client, chicago(date, '20:00').toISOString()), 0, 'at 8:00');
        const movedRows = await rowsFor(client, 'item_id', moved);
        const keys = movedRows.map((row) => row.fire_key);
        if (JSON.stringify(keys) !== JSON.stringify([`${moved}|${date}|19:50`])) {
          throw new Error(`keys: ${JSON.stringify(keys)}`);
        }
        return 'a new (date, time) is a new key; the old time never fires';
      },
    ),
    await attempt('two overlapping ticks on one due minute make one claim', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      const id = await task(client, date, '10:00');
      const due = chicago(date, '10:00').toISOString();

      const other = new pg.Client({
        host: client.host,
        port: client.port,
        user: client.user,
        database: client.database,
      });
      await other.connect();
      try {
        await client.query('begin');
        const first = await claim(client, due);
        // The second tick's insert waits on the first's uncommitted row, then yields to it.
        const second = asRole(other, 'service_role', () =>
          other.query<Claim>(`select * from claim_notifications($1::timestamptz, $2, 20)`, [
            due,
            ZONE,
          ]),
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        await client.query('commit');
        const { rows } = await second;
        expectCount(first, 1, 'the first tick');
        expectCount(rows, 0, 'the overlapping tick');
      } finally {
        await client.query('rollback').catch(ignore);
        await other.end();
      }
      const idRows = await rowsFor(client, 'item_id', id);
      if (idRows.length !== 1) throw new Error('two rows');
      return 'the unique (kind, fire_key) index arbitrates';
    }),
    await attempt(
      'a claim just handed to a tick is not re-handed to the next one while it is being sent',
      async () => {
        await reset(client);
        const now = nextDay();
        const date = ymd(now);
        const due = chicago(date, '13:00');
        await task(client, date, '13:00', 'slow send');
        expectCount(await claim(client, due.toISOString()), 1, 'the first tick');
        // The first tick is still sending: the next minute's tick must leave the claim alone.
        expectCount(await claim(client, at(due, 1)), 0, 'a minute later');
        expectCount(await claim(client, at(due, 4)), 0, 'four minutes later');
        // Past the lease the first tick is presumed gone, and the claim is retried.
        expectCount(await claim(client, at(due, 5)), 1, 'past the lease');
        return 'leased for five minutes from each hand-out, then retried';
      },
    ),
    await attempt('an unsent claim is retried first, until it is abandoned', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      const due = chicago(date, '12:00');
      const failing = await task(client, date, '12:00', 'retried');
      const [claimed] = await claim(client, due.toISOString());
      if (claimed === undefined) throw new Error('nothing claimed');
      await client.query(`update notifications set attempts = 2 where id = $1`, [claimed.id]);
      const later = await task(client, date, '12:01', 'new');

      const retried = await claim(client, at(due, 5));
      if (retried[0]?.id !== claimed.id || retried[0].attempts !== 2 || retried.length !== 2) {
        throw new Error(`retries should come first: ${JSON.stringify(retried)}`);
      }

      await client.query(`update notifications set attempts = 3 where id = $1`, [claimed.id]);
      const third = await claim(client, at(due, 10));
      if (third.some((row) => row.id === claimed.id)) throw new Error('3 attempts still retried');
      const [failingRow] = await rowsFor(client, 'item_id', failing);
      if (failingRow?.abandoned_at === null) {
        throw new Error('not stamped abandoned');
      }

      const [newer] = await rowsFor(client, 'item_id', later);
      if (newer?.abandoned_at !== null) throw new Error('the newer claim was abandoned early');
      const hourOn = await claim(client, at(due, 66));
      if (hourOn.length > 0) throw new Error(`a claim over an hour old was retried`);
      const [laterRow] = await rowsFor(client, 'item_id', later);
      if (laterRow?.abandoned_at === null) {
        throw new Error('the hour-old claim was not abandoned');
      }
      return 'retried while attempts < 3 and under an hour; abandoned after';
    }),
    await attempt(
      'a retry whose subject stopped being eligible is abandoned, never sent',
      async () => {
        await reset(client);
        const now = nextDay();
        const date = ymd(now);
        const done = await task(client, date, '08:00', 'completed later');
        const moved = await task(client, date, '08:00', 'moved later');
        const cleared = await message(client, { verdictAt: at(chicago(date, '08:00'), -1) });
        const retiered = await message(client, { verdictAt: at(chicago(date, '08:00'), -1) });
        expectCount(await claim(client, chicago(date, '08:00').toISOString()), 4, 'the claims');

        await client.query(
          `update items set status = 'completed', completed_at = now() where id = $1`,
          [done],
        );
        await client.query(`update items set due_time = '09:00' where id = $1`, [moved]);
        await client.query(
          `update comm_messages set cleared_at = now(), cleared_by = 'reply' where id = $1`,
          [cleared],
        );
        await verdict(client, retiered, { tier: 'today', at: at(chicago(date, '08:00'), 0) });

        expectCount(await claim(client, chicago(date, '08:01').toISOString()), 0, 'the retry tick');
        const { rows } = await client.query<{ n: string }>(
          `select count(*)::text as n from notifications where abandoned_at is not null`,
        );
        if (rows[0]?.n !== '4') throw new Error(`abandoned ${rows[0]?.n ?? '?'} of 4`);
        return 'completed, moved, cleared and retiered subjects all abandon';
      },
    ),
    await attempt('the limit caps a tick; the overflow is claimed and waits a tick', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      for (const time of ['07:00', '07:01', '07:02']) await task(client, date, time, time);
      const first = await claim(client, chicago(date, '07:05').toISOString(), { limit: 2 });
      const titles = first.map((row) => row.title);
      if (JSON.stringify(titles) !== JSON.stringify(['07:00', '07:01'])) {
        throw new Error(`oldest moment first: ${JSON.stringify(titles)}`);
      }
      for (const row of first) await markSent(client, row.id);
      const next = await claim(client, chicago(date, '07:06').toISOString(), { limit: 2 });
      expectIds(next, [next[0]?.id ?? 'missing'], 'the overflow');
      if (next[0]?.title !== '07:02') throw new Error(`overflow: ${JSON.stringify(next)}`);
      return 'two of three, then the third';
    }),
    await attempt('a missing or unknown zone claims nothing', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      await task(client, date, '06:00');
      for (const zone of ['', 'Not/AZone']) {
        const error = await claim(client, chicago(date, '06:00').toISOString(), { zone }).then(
          ignore,
          (error_: unknown) => error_,
        );
        if (!(error instanceof Error)) throw new Error(`zone '${zone}' did not raise`);
      }
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from notifications`,
      );
      if (rows[0]?.n !== '0') throw new Error('a claim was written');
      return 'raises before writing';
    }),
    await attempt('deleting the message or the task deletes its notification rows', async () => {
      await reset(client);
      const now = nextDay();
      const date = ymd(now);
      const msg = await message(client, { verdictAt: at(chicago(date, '05:00'), -1) });
      const item = await task(client, date, '05:00');
      const claims = await claim(client, chicago(date, '05:00').toISOString());
      expectCount(claims, 2, 'the claims');
      for (const row of claims) await markSent(client, row.id);
      await client.query(`delete from comm_messages where id = $1`, [msg]);
      await client.query(`delete from items where id = $1`, [item]);
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from notifications`,
      );
      if (rows[0]?.n !== '0') throw new Error(`${rows[0]?.n ?? '?'} rows survived`);
      return 'on delete cascade from both subjects';
    }),
    await attempt('notifications: authenticated reads its rows, anon reads none', async () => {
      await reset(client);
      const now = nextDay();
      await message(client, { verdictAt: at(now, -1) });
      expectCount(await claim(client, now.toISOString()), 1, 'the claim');
      const owner = await asRole(client, 'authenticated', () =>
        client.query(`select id from notifications`),
      );
      const anon = await asRole(client, 'anon', () => client.query(`select id from notifications`));
      if (owner.rows.length !== 1 || anon.rows.length > 0) {
        throw new Error(
          `authenticated ${String(owner.rows.length)}, anon ${String(anon.rows.length)}`,
        );
      }
      return 'RLS: the owner sees the stream; anon sees nothing';
    }),
  ];

  await reset(client);
  return results;
}
