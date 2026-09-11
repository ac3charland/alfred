// Worst-case Cloudflare subrequests per Worker invocation, computed from the constants actually
// committed in the source — never retyped here, so this can't drift away from what ships.
import { readFileSync } from 'node:fs';

const read = (path, name) => {
  const src = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  const found = new RegExp(`${name} = (\\d+)`).exec(src);
  if (found === null) throw new Error(`${name} not found in ${path}`);
  return Number(found[1]);
};

const FREE_PLAN_LIMIT = 50;
const gmailIds = read('workers/src/comms/gmail-api.ts', 'MAX_MESSAGE_IDS');
const sweepLimit = read('workers/src/comms/sweep.ts', 'COMMS_SWEEP_LIMIT');
const ingestBatch = read('daemon/src/runner.ts', 'MAX_INGEST_BATCH_MESSAGES');

const crons = readFileSync(new URL('../../../workers/wrangler.toml', import.meta.url), 'utf8')
  .split('\n')
  .find((line) => line.startsWith('crons = '));

// Per-invocation cost models. Each "fixed" is the calls made regardless of how much work is
// waiting; each "per" is what one more message costs.
const paths = [
  {
    name: 'gmail poll     (1-59/2 * * * *)',
    fixed: 7 * 2, // token, profile, account upsert, listing, insert, shelve, poll stamp — x2 accounts
    per: 2, // one getMessage per message, x2 accounts
    n: gmailIds,
  },
  {
    name: 'judge + inbox  (*/2 * * * *)',
    fixed: 11, // inbox sweep, at-ceiling park, 2 eligibility queries, 5 context reads, health stamp
    per: 5, // model call, verdict insert, message patches, rerun clear
    n: sweepLimit,
  },
  {
    name: 'daemon ingest  (POST /comms/ingest)',
    fixed: 4, // account upsert, batch insert, newsletter shelve, heartbeat
    per: 1, // one thread drain per OUTBOUND message — worst case, all of them
    n: ingestBatch,
  },
];

console.log(`Free-plan ceiling: ${FREE_PLAN_LIMIT} subrequests per invocation\n`);
console.log(`${crons}\n`);
for (const { name, fixed, per, n } of paths) {
  const worst = fixed + per * n;
  const verdict = worst <= FREE_PLAN_LIMIT ? 'OK  ' : 'OVER';
  console.log(
    `${verdict} ${name}  ${String(fixed).padStart(2)} fixed + ${per} x ${String(n).padStart(3)} = ${String(worst).padStart(3)}`,
  );
}

console.log('\nBefore this change, in ONE shared invocation:');
const beforeGmail = 14 + 2 * 500;
const beforeSweep = 11 + 5 * 10;
console.log(`OVER gmail poll + judge together    ${beforeGmail} + ${beforeSweep} = ${beforeGmail + beforeSweep}`);
console.log(`OVER daemon ingest of 214 messages  4 + 1 x 214 = ${4 + 214}`);
