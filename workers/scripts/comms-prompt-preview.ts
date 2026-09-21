/**
 * Print the prompt the Comms classifier would send for one evaluation fixture, or show what the
 * roster makes of a handle. Pure — no network, no credential, no clock: it builds the same request
 * `sweep.ts` builds and prints it, against the committed fixtures and `FIXTURE_NOW`.
 *
 * It exists because the prompt is this module's real source code — the schema fixes the shape of
 * the answer and every judgment worth having lives in the text — and until now the only way to
 * read one was to run the billed eval. Two modes:
 *
 *   npm run prompt:comms -w workers -- <fixture-id>          # the assembled request
 *   npm run prompt:comms -w workers -- --resolve <handle>…   # what the people list does with it
 *
 * `--user` prints only the per-message half, which is where the sender line and the thread
 * transcript are; the system half is the same ~1,500 tokens on every call.
 */
import {
  FIXTURES,
  FIXTURE_NOW,
  FIXTURE_PEOPLE,
  FIXTURE_RUBRIC,
  FIXTURE_TIME_ZONE,
} from '../src/comms/eval/fixtures.ts';
import { buildCommsRequest, resolveSender } from '../src/comms/prompt.ts';

const args = process.argv.slice(2);

function usage(): void {
  console.error('usage: <fixture-id> [--user] | --resolve <handle>…');
  console.error(`fixtures: ${FIXTURES.map((fixture) => fixture.id).join(', ')}`);
  process.exitCode = 1;
}

if (args[0] === '--resolve') {
  const handles = args.slice(1);
  if (handles.length === 0) usage();
  for (const handle of handles) {
    const person = resolveSender(handle, FIXTURE_PEOPLE);
    const answer = person === undefined ? 'NO MATCH' : `${person.name} (${person.priority})`;
    console.log(`${handle.padEnd(20)} -> ${answer}`);
  }
} else {
  const id = args[0];
  const fixture = FIXTURES.find((candidate) => candidate.id === id);
  if (fixture === undefined) {
    usage();
  } else {
    const request = buildCommsRequest({
      message: fixture.message,
      account: fixture.account,
      rubric: FIXTURE_RUBRIC,
      examples: [],
      people: FIXTURE_PEOPLE,
      timeZone: FIXTURE_TIME_ZONE,
      now: FIXTURE_NOW,
      thread: fixture.thread,
    });
    if (!args.includes('--user')) console.log(`${request.system}\n\n${'─'.repeat(78)}\n`);
    console.log(request.user);
  }
}
