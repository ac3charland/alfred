/**
 * The ninety-day text sweep, against a REAL Postgres.
 *
 * Boots the database package's throwaway cluster, applies every migration exactly as production
 * does, inserts four posts either side of the retention window, and calls `reader_sweep_text`
 * the way the Worker does — one batch per call, until a batch reports 0. Then calls it with
 * `p_days => 0` to show the floor refusing rather than emptying the table.
 *
 * Every printed value is derived (an age in whole days, a boolean, a character count) rather than
 * an id or a timestamp, so the output is byte-identical on every run and `demo -- verify` stays
 * green.
 *
 * Run from the repo root: `node docs/demos/alf-234-reader-operability/retention-sweep.mjs`
 */
import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

const PUBLICATION_ID = '00000000-0000-4000-8000-0000000000b1';

/**
 * Four posts: two past the ninety-day window, one comfortably inside it, and one past the window
 * that arrived with nothing readable in it — the sweep has nothing to take from that last one, so
 * it must leave `text_swept_at` null rather than claim to have swept it.
 */
const POSTS = [
  { id: '00000000-0000-4000-8000-0000000000a1', label: 'A · 91 days old', days: 91 },
  { id: '00000000-0000-4000-8000-0000000000a2', label: 'B · 89 days old', days: 89 },
  { id: '00000000-0000-4000-8000-0000000000a3', label: 'C · 120 days old', days: 120 },
  { id: '00000000-0000-4000-8000-0000000000a4', label: 'D · 200 days, no body', days: 200, empty: true },
];

/** The columns the sweep must leave alone, printed as "still there" rather than as values. */
const SURVIVES = `title is not null as title, gist is not null as gist,
                  overview is not null as overview, summarized_at is not null as summarized_at`;

async function report(client, heading) {
  const { rows } = await client.query(
    `select id,
            (extract(day from now() - received_at))::int as age_days,
            coalesce(length(text), 0) as text_chars,
            text_swept_at is not null as swept,
            ${SURVIVES}
       from reader_posts order by id`,
  );
  console.log(`\n${heading}`);
  for (const row of rows) {
    const post = POSTS.find((candidate) => candidate.id === row.id);
    console.log(
      `  ${post.label}  text=${String(row.text_chars).padStart(4)} chars` +
        `  swept=${String(row.swept).padEnd(5)}` +
        `  title/gist/overview/summarized_at kept=${String(
          row.title && row.gist && row.overview && row.summarized_at,
        )}`,
    );
  }
}

async function main() {
  const cluster = await startCluster();
  const client = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: cluster.user,
    database: cluster.database,
  });

  try {
    await client.connect();
    await bootstrapSupabase(client);
    await applyMigrations(client);

    await client.query(
      `insert into reader_publications (id, handle, name, domain, enabled, source)
       values ($1, 'secondthoughts@substack.com', 'Second Thoughts', 'substack.com', true, 'auto')`,
      [PUBLICATION_ID],
    );

    for (const post of POSTS) {
      await client.query(
        `insert into reader_posts
           (id, publication_id, account_key, gmail_message_id, title, received_at,
            text, word_count, html_extracted, headline, gist, overview,
            model, prompt_version, summary_state, summarized_at)
         values ($1, $2, 'gmail-personal', $4, 'A post worth keeping the summary of',
                 now() - make_interval(days => $3),
                 repeat('the stored body of the post. ', $5), $6, true,
                 'The headline the model wrote.', 'The gist the model wrote.',
                 '{"novel_ideas":[],"evidence":[],"argument":"x","who_should_read":"y"}'::jsonb,
                 'claude-sonnet-5', 1, 'done', now() - make_interval(days => $3))`,
        [post.id, PUBLICATION_ID, post.days, post.id, post.empty ? 0 : 40, post.empty ? 0 : 240],
      );
    }

    await report(client, 'Before the sweep:');

    // One batch per call, exactly as the Worker loops it — p_limit 1 here so the batching is
    // visible in three lines instead of one.
    console.log('\nreader_sweep_text(90, 1), called until it returns 0:');
    for (let call = 1; call <= 3; call += 1) {
      const { rows } = await client.query('select reader_sweep_text(90, 1) as swept');
      console.log(`  call ${String(call)} → ${String(rows[0].swept)} row(s) swept`);
    }

    await report(client, 'After the sweep:');

    // The function runs as the CALLER, which on this database includes `authenticated`, so a
    // p_days of 0 would otherwise null every body in the table in one call.
    console.log('\nreader_sweep_text(0, 1) — the floor, from a session that asks for everything:');
    try {
      await client.query('select reader_sweep_text(0, 1)');
      console.log('  it swept');
    } catch (error) {
      console.log(`  ${error.message}`);
    }
  } finally {
    await client.end();
    cluster.stop();
  }
}

await main();
