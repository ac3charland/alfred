import type { Client } from 'pg';

import { type AssertionResult, attempt } from './assertions.ts';

/**
 * The recording half of the coding-session ledger (ALF-310): the hook's write
 * (`record_code_session`), the amended backfill upsert, and the price history that turns recorded
 * tokens into a cost. Every ownership rule lives in SQL, so this is where it is pinned.
 */

type Row = Record<string, unknown>;
type Role = 'authenticated' | 'service_role';

const REPO = 'ac3charland/alfred';

// Invented rates in USD per MTok, shaped like the pricing page's table.
const OPUS = { name: 'Claude Opus 5.5', in: 4, cw5m: 5, cw1h: 8, read: 0.2, out: 20 };
const OPUS_RAISED = { ...OPUS, out: 30 };
const HAIKU = { name: 'Claude Haiku 4.5', in: 1, cw5m: 1.25, cw1h: 2, read: 0.1, out: 5 };

/** One model's usage in `usage_by_model`, every token class set. */
function usage(input: number, output: number, cacheRead: number, cw5m: number, cw1h: number): Row {
  return {
    requests: 3,
    input,
    output,
    cache_read: cacheRead,
    cache_write_5m: cw5m,
    cache_write_1h: cw1h,
    web_search: 1,
  };
}

// Priced by hand at OPUS and HAIKU:
//   opus  4·4118 + 5·903114 + 8·1000 + 0.2·41877310 + 20·212406 = 17 163 624   → 17.163624
//   haiku 1·1234 + 1.25·20000 + 2·3000 + 0.1·500000 + 5·14095   =    152 709   →  0.152709
const USAGE = {
  main: { 'claude-opus-5-5': usage(4118, 212_406, 41_877_310, 903_114, 1000) },
  subagents: { 'claude-haiku-4-5-20251001': usage(1234, 14_095, 500_000, 20_000, 3000) },
};
const USAGE_COST = '17.316333';

async function asRole<T>(client: Client, role: string, fn: () => Promise<T>): Promise<T> {
  await client.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await client.query('reset role');
  }
}

async function record(client: Client, row: Row, role: Role = 'service_role'): Promise<boolean> {
  const { rows } = await asRole(client, role, () =>
    client.query<{ inserted: boolean }>(`select * from record_code_session($1::jsonb)`, [
      JSON.stringify(row),
    ]),
  );
  const result = rows[0];
  if (!result) throw new Error('record_code_session returned no row');
  return result.inserted;
}

async function upsert(client: Client, rows: Row[]): Promise<void> {
  await asRole(client, 'service_role', () =>
    client.query(`select * from upsert_code_sessions($1::jsonb)`, [JSON.stringify(rows)]),
  );
}

interface AppendResult {
  appended: boolean;
  changed: string[];
  repriced: number;
}

async function appendPrices(client: Client, rates: Row): Promise<AppendResult> {
  const { rows } = await asRole(client, 'service_role', () =>
    client.query<AppendResult>(`select * from append_model_prices($1::jsonb, $2)`, [
      JSON.stringify(rates),
      'https://example.test/pricing.md',
    ]),
  );
  const result = rows[0];
  if (!result) throw new Error('append_model_prices returned no row');
  return result;
}

/** The whole stored row as JSON, keys sorted (jsonb orders them). */
async function read(client: Client, id: string): Promise<Row> {
  const { rows } = await client.query<{ row: Row }>(
    `select to_jsonb(s) as row from code_sessions s where session_id = $1`,
    [id],
  );
  const found = rows[0];
  if (!found) throw new Error(`no ledger row for ${id}`);
  return found.row;
}

/** Everything but the write stamps, which differ with the order of writes by design. */
async function readComparable(client: Client, id: string): Promise<Row> {
  const { rows } = await client.query<{ row: Row }>(
    `select to_jsonb(s) - 'session_id' - 'recorded_at' - 'refreshed_at' as row
       from code_sessions s where session_id = $1`,
    [id],
  );
  const found = rows[0];
  if (!found) throw new Error(`no ledger row for ${id}`);
  return found.row;
}

async function cleanUp(client: Client): Promise<void> {
  await client.query(`delete from code_sessions where session_id like 'session_hook%'`);
  await client.query(`delete from model_price_history`);
}

/** Seed history rows at chosen instants, bypassing append (whose instant is the clock's). */
async function seedHistory(client: Client, entries: { at: string; rates: Row }[]): Promise<void> {
  for (const entry of entries) {
    await client.query(
      `insert into model_price_history (effective_from, fetched_at, source, rates)
       values ($1, $1, 'seed', $2::jsonb)`,
      [entry.at, JSON.stringify(entry.rates)],
    );
  }
}

/** Structural equality that ignores object key order — jsonb reorders keys. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    // JSON has no undefined: a SQL null read back and an omitted expectation are the same thing.
    return (a ?? undefined) === (b ?? undefined);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]))
  );
}

/** A SQL null read back: the value is absent. */
function expectNull(label: string, actual: unknown): void {
  if (actual !== undefined && actual !== null) {
    throw new Error(`${label}: expected null, got ${JSON.stringify(actual)}`);
  }
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// The hook's three writes for one session, in the shapes the route forwards.
function hookStart(id: string): Row {
  return {
    event: 'session-start',
    session_id: id,
    repo: REPO,
    session_created_at: '2026-10-03T09:12:40Z',
    base_sha: 'base-recorded',
    builder_sha: 'builder-recorded',
    warnings: [],
  };
}

function hookStop(id: string, prompt: string, output: number): Row {
  return {
    event: 'stop',
    session_id: id,
    repo: REPO,
    prompt,
    skills: [{ path: '.claude/skills/implement-spec/SKILL.md', blob_sha: 'skill-recorded' }],
    ref: 'ALF-310',
    model: 'claude-opus-5-5',
    served_model: 'claude-opus-5-5',
    effort_level: 'max',
    session_created_at: '2026-10-03T09:12:41Z',
    input_tokens: 5352,
    output_tokens: output,
    cache_read_tokens: 42_377_310,
    cache_write_tokens: 927_114,
    subagent_count: 1,
    usage_by_model: USAGE,
    warnings: [],
  };
}

/** A backfill row for the same session: every column but refreshed_at, as the CLI sends it. */
function backfillRow(id: string): Row {
  return {
    session_id: id,
    repo: REPO,
    title: 'ALF-310: Create hooks to log session metrics',
    session_created_at: '2026-10-03T09:12:39Z',
    status: 'SESSION_STATUS_BUCKET_COMPLETED',
    configured_model: 'claude-opus-5-5',
    model: 'claude-opus-5-5',
    served_model: 'claude-sonnet-5-5',
    effort_level: 'high',
    cost_usd: 99.5,
    input_tokens: 1,
    output_tokens: 999_999_999,
    cache_read_tokens: 3,
    cache_write_tokens: 4,
    ref: undefined,
    launch_lane: 'implementation',
    pr_number: 428,
    pr_state: 'merged',
    pr_opened_at: '2026-10-03T11:00:00Z',
    pr_merged_at: '2026-10-03T12:00:00Z',
    pr_closed_at: '2026-10-03T12:00:00Z',
    human_commits_after_open: 0,
    base_sha: 'base-rebuilt',
    builder_sha: 'builder-rebuilt',
    prompt: 'a rebuilt guess',
    prompt_source: 'reconstructed',
    spec_path: 'docs/specs/ALF-310.html',
    spec_blob_sha: 'spec-blob',
    skills: [{ path: '.claude/skills/implement-spec/SKILL.md', blob_sha: 'skill-rebuilt' }],
    warnings: ['builder_changed_near_start'],
    session_record: { fixture: true },
    // Recording-only columns a backfill must never write, even when a row carries them.
    subagent_count: 7,
    usage_by_model: { main: {}, subagents: {} },
    recorded_at: '2000-01-01T00:00:00Z',
  };
}

export async function runSessionLedgerAssertions(client: Client): Promise<AssertionResult[]> {
  const grantsResult = await attempt(
    'the recording functions are security invoker and executable by the API roles, and anon ' +
      'reads no price history (ALF-310)',
    async () => {
      const names = [
        'record_code_session',
        'append_model_prices',
        'model_rates',
        'code_session_cost',
        'code_session_hook_warnings',
        'code_session_priced_warnings',
        'upsert_code_sessions',
      ];
      const { rows } = await client.query<{
        name: string;
        secdef: boolean;
        anon: boolean;
        auth: boolean;
        sr: boolean;
      }>(
        `select p.proname as name, p.prosecdef as secdef,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as sr
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any($1)`,
        [names],
      );
      expectEqual('one function per name', rows.length, names.length);
      for (const fn of rows) {
        if (fn.secdef) throw new Error(`${fn.name} is security definer`);
        if (!fn.anon || !fn.auth || !fn.sr) throw new Error(`${fn.name} lacks EXECUTE`);
      }

      await seedHistory(client, [
        { at: '2026-01-01T00:00:00Z', rates: { 'claude-opus-5-5': OPUS } },
      ]);
      const anon = await asRole(client, 'anon', () =>
        client.query(`select * from model_price_history`),
      );
      const owner = await asRole(client, 'authenticated', () =>
        client.query(`select * from model_price_history`),
      );
      await cleanUp(client);
      if (anon.rows.length > 0) throw new Error('anon can read the price history');
      expectEqual('authenticated reads the history', owner.rows.length, 1);
      return `${String(rows.length)} functions invoker + granted; anon sees no prices`;
    },
  );

  const ratesResult = await attempt(
    'model_rates reads the table in effect, applies a launch price back to first use, and strips ' +
      'only a date suffix (ALF-310)',
    async () => {
      const opusOld = { ...OPUS, name: 'Claude Opus 5', in: 5 };
      await seedHistory(client, [
        { at: '2026-01-01T00:00:00Z', rates: { 'claude-opus-5': opusOld } },
        {
          at: '2026-06-01T00:00:00Z',
          rates: { 'claude-opus-5': OPUS, 'claude-opus-5-5': OPUS, 'claude-haiku-4-5': HAIKU },
        },
      ]);
      const rate = async (model: string, at: string): Promise<unknown> => {
        const { rows } = await asRole(client, 'authenticated', () =>
          client.query<{ r: unknown }>(`select model_rates($1, $2) as r`, [model, at]),
        );
        return rows[0]?.r;
      };
      try {
        expectEqual('in effect at t', await rate('claude-opus-5', '2026-03-01T00:00:00Z'), opusOld);
        expectEqual('after a change', await rate('claude-opus-5', '2026-07-01T00:00:00Z'), OPUS);
        expectEqual('before any row', await rate('claude-opus-5', '2025-06-01T00:00:00Z'), opusOld);
        expectEqual(
          'a dated id at its launch price',
          await rate('claude-haiku-4-5-20251001', '2026-03-01T00:00:00Z'),
          HAIKU,
        );
        expectNull('no prefix match', await rate('claude-opus-5-9', '2026-07-01T00:00:00Z'));
        expectNull('fast mode', await rate('claude-opus-5-5/fast', '2026-07-01T00:00:00Z'));
      } finally {
        await cleanUp(client);
      }
      return 'in effect, launch price, date suffix, and no guess for 5-9 or /fast';
    },
  );

  const costResult = await attempt(
    'code_session_cost prices all five token classes per model, main and subagents, and is null ' +
      'when any model is unpriced (ALF-310)',
    async () => {
      await seedHistory(client, [
        {
          at: '2026-01-01T00:00:00Z',
          rates: { 'claude-opus-5-5': OPUS, 'claude-haiku-4-5': HAIKU },
        },
      ]);
      const cost = async (value?: unknown): Promise<string | undefined> => {
        const { rows } = await asRole(client, 'service_role', () =>
          client.query<{ c: string | null }>(
            `select code_session_cost($1::jsonb, '2026-10-03T00:00:00Z')::text as c`,
            [value === undefined ? undefined : JSON.stringify(value)],
          ),
        );
        return rows[0]?.c ?? undefined;
      };
      try {
        expectEqual('hand-computed cost', await cost(USAGE), USAGE_COST);
        expectNull(
          'one unpriced subagent model',
          await cost({ ...USAGE, subagents: { 'claude-mystery-1': usage(1, 1, 1, 1, 1) } }),
        );
        expectNull('no usage', await cost());
        expectEqual('empty usage', await cost({ main: {}, subagents: {} }), '0.000000');
      } finally {
        await cleanUp(client);
      }
      return `${USAGE_COST} to 6 places; null with an unpriced model`;
    },
  );

  const appendResult = await attempt(
    'append_model_prices appends only on a change, keeps a model a fetch omits, and re-prices ' +
      'recorded rows only (ALF-310)',
    async () => {
      try {
        // A recorded session from before any fetch, one far in the future, and a backfill-only one.
        await record(client, {
          ...hookStop('session_hook_past', 'p', 10),
          session_created_at: '2020-01-01T00:00:00Z',
        });
        await record(client, {
          ...hookStop('session_hook_future', 'p', 10),
          session_created_at: '2999-01-01T00:00:00Z',
        });
        await upsert(client, [{ ...backfillRow('session_hook_backfilled'), cost_usd: 9.99 }]);
        const past = await read(client, 'session_hook_past');
        expectEqual(
          'unpriced before any fetch',
          [past['cost_usd'], past['warnings']],
          [undefined, ['price_unknown']],
        );

        const first = await appendPrices(client, {
          'claude-opus-5-5': OPUS,
          'claude-haiku-4-5': HAIKU,
        });
        expectEqual('first fetch', first, {
          appended: true,
          changed: ['claude-haiku-4-5', 'claude-opus-5-5'],
          repriced: 2,
        });
        const priced = await read(client, 'session_hook_past');
        expectEqual(
          'priced at launch',
          [String(priced['cost_usd']), priced['warnings']],
          [USAGE_COST, []],
        );
        const backfilled = await read(client, 'session_hook_backfilled');
        expectEqual('backfill-only row untouched', backfilled['cost_usd'], 9.99);

        const same = await appendPrices(client, {
          'claude-opus-5-5': { ...OPUS, name: 'renamed only' },
          'claude-haiku-4-5': HAIKU,
        });
        expectEqual('identical rates', same, { appended: false, changed: [], repriced: 0 });

        // Opus's output rate changes and Haiku is missing from this fetch.
        const raised = await appendPrices(client, { 'claude-opus-5-5': OPUS_RAISED });
        expectEqual('one changed model', raised, {
          appended: true,
          changed: ['claude-opus-5-5'],
          repriced: 1, // only the future session; the past one keeps the rates of its time
        });
        const { rows } = await client.query<{ n: number; latest: Row }>(
          `select count(*)::int as n,
                  (select rates from model_price_history order by effective_from desc limit 1) as latest
             from model_price_history`,
        );
        expectEqual('history rows', rows[0]?.n, 2);
        expectEqual('omitted model kept', rows[0]?.latest['claude-haiku-4-5'], HAIKU);

        let rejected = false;
        try {
          await appendPrices(client, { 'claude-opus-5-5': { ...OPUS, out: 'twenty' } });
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error('a malformed rate was accepted');
      } finally {
        await cleanUp(client);
      }
      return 'append on change only; omitted model kept; recorded rows re-priced, backfill rows not';
    },
  );

  const ownershipResult = await attempt(
    'record_code_session freezes the first prompt, fills platform columns only while null, never ' +
      'writes backfill columns or a sent cost, and never lets usage go backwards (ALF-310)',
    async () => {
      const id = 'session_hook_own';
      try {
        await seedHistory(client, [
          {
            at: '2026-01-01T00:00:00Z',
            rates: { 'claude-opus-5-5': OPUS, 'claude-haiku-4-5': HAIKU },
          },
        ]);
        expectEqual(
          'first write inserts',
          await record(client, hookStart(id), 'authenticated'),
          true,
        );
        const started = await read(client, id);
        expectEqual(
          'start captured',
          [started['base_sha'], started['builder_sha']],
          ['base-recorded', 'builder-recorded'],
        );
        if (started['recorded_at'] === null) throw new Error('recorded_at not stamped');

        const firstStop = {
          ...hookStop(id, 'ALF-310: the prompt exactly as sent', 1000),
          // None of these may land: a cost, a backfill-only column, a base outside session-start,
          // and a warning code the hook doesn't own.
          cost_usd: 1234,
          pr_state: 'open',
          launch_lane: 'bug',
          base_sha: 'base-from-a-stop',
          warnings: ['subagents_unreadable', 'no_pr'],
        };
        expectEqual('later writes update', await record(client, firstStop, 'authenticated'), false);
        const one = await read(client, id);
        expectEqual(
          'first stop',
          [one['prompt'], one['prompt_source'], one['ref'], one['effort_level'], one['base_sha']],
          ['ALF-310: the prompt exactly as sent', 'recorded', 'ALF-310', 'max', 'base-recorded'],
        );
        expectEqual(
          'backfill columns untouched',
          [one['pr_state'], one['launch_lane']],
          [undefined, undefined],
        );
        expectEqual('cost priced, not sent', String(one['cost_usd']), USAGE_COST);
        expectEqual('only hook codes', one['warnings'], ['subagents_unreadable']);
        expectEqual(
          'created_at from session start',
          Date.parse(String(one['session_created_at'])),
          Date.parse('2026-10-03T09:12:40Z'),
        );

        await record(
          client,
          {
            ...hookStop(id, 'a later message', 2000),
            skills: [],
            ref: 'ALF-999',
            model: 'claude-sonnet-5-5',
            served_model: 'claude-sonnet-5-5',
          },
          'authenticated',
        );
        const two = await read(client, id);
        expectEqual(
          'frozen prompt',
          [two['prompt'], two['skills'], two['ref'], two['model']],
          [one['prompt'], one['skills'], 'ALF-310', 'claude-opus-5-5'],
        );
        expectEqual(
          'usage refreshed',
          [two['output_tokens'], two['served_model']],
          [2000, 'claude-sonnet-5-5'],
        );
        expectEqual('an absent hook code drops', two['warnings'], []);

        await record(client, { ...hookStop(id, 'x', 1500), subagent_count: 9 }, 'authenticated');
        const regressed = await read(client, id);
        expectEqual(
          'usage kept',
          [regressed['output_tokens'], regressed['subagent_count']],
          [2000, 1],
        );
        expectEqual('regression flagged', regressed['warnings'], ['transcript_regressed']);

        await record(client, hookStop(id, 'x', 3000), 'authenticated');
        const recovered = await read(client, id);
        expectEqual('usage moves on', recovered['output_tokens'], 3000);
        expectEqual('regression sticks', recovered['warnings'], ['transcript_regressed']);

        let rejected = false;
        try {
          await record(client, { ...hookStart(id), event: 'session-end' });
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error('an unknown event was accepted');
      } finally {
        await cleanUp(client);
      }
      return 'prompt frozen, class 3 fill-only, class 4 and cost ignored, D13 guard + sticky flag';
    },
  );

  const orderResult = await attempt(
    'the hook and a backfill leave the same row whether the backfill runs before, between or ' +
      'after the hook writes (ALF-310)',
    async () => {
      try {
        await seedHistory(client, [
          {
            at: '2026-01-01T00:00:00Z',
            rates: { 'claude-opus-5-5': OPUS, 'claude-haiku-4-5': HAIKU },
          },
        ]);
        const run = async (id: string, backfillAt: number): Promise<Row> => {
          const writes: (() => Promise<unknown>)[] = [
            () => record(client, hookStart(id)),
            () => record(client, hookStop(id, 'ALF-310: as sent', 1000)),
            () => record(client, hookStop(id, 'a later message', 2000)),
          ];
          writes.splice(backfillAt, 0, () => upsert(client, [backfillRow(id)]));
          for (const write of writes) await write();
          return readComparable(client, id);
        };
        const before = await run('session_hook_before', 0);
        const between = await run('session_hook_between', 1);
        const after = await run('session_hook_after', 3);
        for (const [name, other] of [
          ['between', between],
          ['after', after],
        ] as const) {
          const differing = Object.keys(before).filter(
            (key) => !deepEqual(before[key], other[key]),
          );
          if (differing.length > 0) {
            throw new Error(
              `backfill ${name} differs from before on ${differing
                .map(
                  (key) =>
                    `${key} (${JSON.stringify(before[key])} vs ${JSON.stringify(other[key])})`,
                )
                .join(', ')}`,
            );
          }
        }

        const row = await read(client, 'session_hook_after');
        expectEqual(
          'hook-owned kept',
          [
            row['output_tokens'],
            row['served_model'],
            String(row['cost_usd']),
            row['subagent_count'],
          ],
          [2000, 'claude-opus-5-5', USAGE_COST, 1],
        );
        expectEqual(
          'recorded wins',
          [row['prompt'], row['prompt_source'], row['base_sha'], row['builder_sha']],
          ['ALF-310: as sent', 'recorded', 'base-recorded', 'builder-recorded'],
        );
        expectEqual('recorded skills', row['skills'], hookStop('x', '', 0)['skills']);
        expectEqual(
          'platform-owned',
          [Date.parse(String(row['session_created_at'])), row['effort_level'], row['ref']],
          [Date.parse('2026-10-03T09:12:39Z'), 'high', 'ALF-310'],
        );
        expectEqual(
          'backfill-only filled',
          [row['pr_state'], row['launch_lane']],
          ['merged', 'implementation'],
        );
        expectEqual('recording columns never from the backfill', row['usage_by_model'], USAGE);
        expectEqual('both paths keep their codes', row['warnings'], ['builder_changed_near_start']);
      } finally {
        await cleanUp(client);
      }
      return 'before, between and after all give one row';
    },
  );

  const unrecordedStartResult = await attempt(
    'a backfill fills the start the hook never recorded, and keeps the recorded prompt (ALF-310)',
    async () => {
      const id = 'session_hook_nostart';
      try {
        await record(client, {
          ...hookStop(id, 'ALF-310: as sent', 1000),
          skills: undefined,
          warnings: ['start_unrecorded'],
        });
        // A JSON null `skills` reads as "none sent", like an absent key, not as a null column.
        await asRole(client, 'service_role', () =>
          client.query(`select record_code_session(jsonb_set($1::jsonb, '{skills}', 'null'))`, [
            JSON.stringify(hookStop('session_hook_nullskills', 'ALF-310: as sent', 1000)),
          ]),
        );
        const nullSkills = await read(client, 'session_hook_nullskills');
        expectEqual('null skills keep the default', nullSkills['skills'], []);
        await upsert(client, [{ ...backfillRow(id), warnings: ['no_pr'] }]);
        const row = await read(client, id);
        expectEqual(
          'filled by the backfill',
          [row['base_sha'], row['builder_sha'], row['skills']],
          ['base-rebuilt', 'builder-rebuilt', backfillRow(id)['skills']],
        );
        expectEqual(
          'prompt kept',
          [row['prompt'], row['prompt_source']],
          ['ALF-310: as sent', 'recorded'],
        );
        expectEqual('codes merged', row['warnings'], [
          'no_pr',
          'price_unknown',
          'start_unrecorded',
        ]);
        expectEqual(
          'never written by a backfill',
          Date.parse(String(row['recorded_at'])) === Date.parse('2000-01-01T00:00:00Z'),
          false,
        );
      } finally {
        await cleanUp(client);
      }
      return 'base, builder and skills from the backfill; prompt recorded; codes from both';
    },
  );

  return [
    grantsResult,
    ratesResult,
    costResult,
    appendResult,
    ownershipResult,
    orderResult,
    unrecordedStartResult,
  ];
}
