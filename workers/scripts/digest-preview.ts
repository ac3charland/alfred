/**
 * Print the morning digest for one of its reference states, built from the committed fixtures
 * with the opener stubbed — no network, no credential, no clock. The Telegram HTML by default,
 * or the plain-text twin with `--plain`:
 *
 *   npm run digest:preview -w workers -- normal
 *   npm run digest:preview -w workers -- model-unavailable --plain
 *
 * States: normal, model-unavailable, no-plan, quiet. Deterministic, so a demo doc can exec it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_URL, ZONE, digestStates } from '../src/digest/fixtures/states.ts';
import { buildDigest, prepareDigest } from '../src/digest/format.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const planHtml = readFileSync(
  path.join(here, '..', 'src', 'digest', 'fixtures', 'weekly-plan.html'),
  'utf8',
);
const states = digestStates(planHtml);

const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith('--')) ?? 'normal';
const state = states[name];
if (state === undefined) {
  throw new Error(`unknown state "${name}"; one of: ${Object.keys(states).join(', ')}`);
}

const { digest } = prepareDigest(state.facts, state.now, ZONE);
const text = buildDigest(digest, state.opener, APP_URL);
console.log(args.includes('--plain') ? text.plain : text.html);
