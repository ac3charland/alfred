// The dispatch table, read from what actually ships: the constants the `scheduled` handler
// compares against, and the schedules wrangler.toml registers. Nothing here is restated, so the
// demo cannot drift away from the source.
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const index = read('../../../workers/src/index.ts');
const toml = read('../../../workers/wrangler.toml');

const constant = (name) =>
  new RegExp(`export const ${name} = '([^']+)'`).exec(index)?.[1] ?? '(missing)';

const dispatched = {
  TICK_CRON: constant('TICK_CRON'),
  POLL_CRON: constant('POLL_CRON'),
  RETENTION_CRON: constant('RETENTION_CRON'),
};

const declared = [...(/^crons = \[(.+)\]$/m.exec(toml)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
  (match) => match[1],
);

// A stepped range with a NONZERO start is the trap: Cloudflare runs the offset-free form, so two
// such schedules can collapse onto one expression and the dispatch stops being able to tell them
// apart. An offset-free expression cannot.
const OFFSET_STEP = /(?:^|\s)([1-9]\d*)-\d+\/\d+(?=\s|$)/;

console.log('Schedules the handler dispatches on:\n');
for (const [name, cron] of Object.entries(dispatched)) {
  const collapsible = OFFSET_STEP.test(cron);
  console.log(
    `  ${collapsible ? 'TRAP' : 'OK  '} ${name.padEnd(15)} ${cron.padEnd(16)}` +
      `${declared.includes(cron) ? 'registered' : 'NOT REGISTERED by wrangler.toml'}`,
  );
}

const unhandled = declared.filter((cron) => !Object.values(dispatched).includes(cron));
console.log(`\nRegistered but unhandled: ${unhandled.length === 0 ? 'none' : unhandled.join(', ')}`);
console.log(
  `Distinct expressions: ${String(new Set(Object.values(dispatched)).size)} of ${String(Object.keys(dispatched).length)}`,
);
