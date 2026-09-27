/**
 * `append_wiki_sent_picks` on real Postgres: stands up the same throwaway cluster the database
 * integration suite and `npm run describe -w database` use, applies every committed migration in
 * production's order, then calls the RPC as the `authenticated` role, the way the send route does.
 *
 *   node docs/demos/alf-271-evidence-to-wiki/append-picks.ts
 */
import process from 'node:process';

import pg from 'pg';

import { startCluster } from '../../../database/src/cluster.ts';
import { applyMigrations, bootstrapSupabase } from '../../../database/src/migrate.ts';

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

  const { rows: columns } = await client.query<{ column_name: string; line: string }>(
    `select column_name, column_name || '  ' || data_type || '  ' ||
            case when is_nullable = 'NO' then 'not null' else 'null' end ||
            '  default ' || column_default as line
       from information_schema.columns
      where table_name = 'reader_posts' and column_name like 'wiki_sent_%'
      order by column_name`,
  );
  console.log('reader_posts:');
  for (const { line } of columns) console.log(`  ${line}`);

  const { rows: functions } = await client.query<{ signature: string }>(
    `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
       from pg_proc p
      where p.proname like 'append_wiki_sent_%'
      order by p.proname`,
  );
  console.log('functions (the ideas-only original stays, expand-then-contract):');
  for (const { signature } of functions) console.log(`  ${signature}`);
  console.log();

  const { rows: publication } = await client.query<{ id: string }>(
    `insert into reader_publications (handle, name, source)
       values ('demo@example.com', 'Demo', 'owner') returning id`,
  );
  const { rows: post } = await client.query<{ id: string }>(
    `insert into reader_posts (publication_id, account_key, gmail_message_id, title, received_at)
       values ($1, 'gmail-personal', 'demo-msg', 'Why habits stick', now()) returning id`,
    [publication[0]?.id],
  );
  const id = post[0]?.id;

  const append = async (ideas: string[], evidence: string[]): Promise<void> => {
    await client.query('set role authenticated');
    try {
      const { rows } = await client.query<{
        wiki_sent_ideas: string[];
        wiki_sent_evidence: string[];
      }>(
        `select wiki_sent_ideas, wiki_sent_evidence
           from append_wiki_sent_picks($1, $2::text[], $3::text[])`,
        [id, ideas, evidence],
      );
      console.log(`append ideas ${JSON.stringify(ideas)}, evidence ${JSON.stringify(evidence)}`);
      console.log(`  → wiki_sent_ideas    ${JSON.stringify(rows[0]?.wiki_sent_ideas)}`);
      console.log(`  → wiki_sent_evidence ${JSON.stringify(rows[0]?.wiki_sent_evidence)}`);
    } finally {
      await client.query('reset role');
    }
  };

  // Out of alphabetical order, with a repeat in each list: kept in first-occurrence order, once.
  await append(['Cue beats clock', 'Streaks mislead', 'Cue beats clock'], ['Lally 2010', 'Lally 2010']);
  // The same text in the other section is a different bullet, and an already-sent one is skipped.
  await append(['Lally 2010', 'Streaks mislead'], ['Cue beats clock']);
  // An empty list leaves its column exactly as it was.
  await append([], ['A 2,000-user survey']);
} finally {
  await client.end();
  cluster.stop();
}
