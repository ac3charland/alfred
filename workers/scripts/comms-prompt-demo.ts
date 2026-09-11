/**
 * Print the request the Comms classifier would send for one evaluation fixture — the assembled
 * system prompt and user message, and nothing else.
 *
 * No model call, no network, no key: `buildCommsRequest` is pure, and the fixture rubric, roster
 * and clock are all pinned, so the output is byte-identical on every machine. That is what makes
 * it demo-doc evidence rather than a screenshot of a terminal.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/comms-prompt-demo.ts <fixture-id> [...]
 *
 * Fixture ids come from `src/comms/eval/fixtures.ts`.
 */
import {
  FIXTURES,
  FIXTURE_NOW,
  FIXTURE_PEOPLE,
  FIXTURE_RUBRIC,
  FIXTURE_TIME_ZONE,
} from '../src/comms/eval/fixtures.ts';
import { buildCommsRequest } from '../src/comms/prompt.ts';

const wanted = process.argv.slice(2);

if (wanted.length === 0) {
  console.error('Usage: comms-prompt-demo.ts <fixture-id> [...]');
  console.error(`Known ids: ${FIXTURES.map((fixture) => fixture.id).join(', ')}`);
  process.exitCode = 1;
} else {
  for (const id of wanted) {
    const fixture = FIXTURES.find((entry) => entry.id === id);
    if (fixture === undefined) {
      console.error(`No fixture named ${id}`);
      process.exitCode = 1;
      continue;
    }

    const request = buildCommsRequest({
      message: fixture.message,
      account: fixture.account,
      rubric: FIXTURE_RUBRIC,
      // The per-tick draw is empty here so the fixture rubric and roster are the only policy on
      // show; the example set is demonstrated on its own page in the app.
      examples: [],
      people: FIXTURE_PEOPLE,
      timeZone: FIXTURE_TIME_ZONE,
      now: FIXTURE_NOW,
    });

    console.log(`===== ${fixture.id} — ${fixture.about}`);
    console.log('----- system -----');
    console.log(request.system);
    console.log('----- user -----');
    console.log(request.user);
    console.log('');
  }
}
