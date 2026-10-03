/**
 * The classifier's side of due times, through the Worker's real code: what the model is told,
 * the schema it answers in, and what of an answer reaches the row. No model is called — this
 * shows the request the Worker builds and the validate → merge steps its answer goes through.
 *
 *   node --import ./workers/scripts/ts-resolve.mjs docs/demos/due-times/classifier.ts
 */
import { PROMPT_VERSION, buildRequest } from '../../../workers/src/prompt.ts';
import {
  type ClosedWorld,
  type SweepItem,
  mergeIntoItem,
  parseVerdict,
  validateVerdict,
} from '../../../workers/src/verdict.ts';

const world: ClosedWorld = { folders: [], projects: [], epics: [] };

function capture(title: string, held: Partial<SweepItem> = {}): SweepItem {
  return {
    id: 'item-1',
    title,
    notes: undefined,
    raw_capture: title,
    source_url: undefined,
    item_type: 'unclassified',
    priority: undefined,
    due_date: undefined,
    due_time: undefined,
    folder_id: undefined,
    intended_project_id: undefined,
    intended_epic_id: undefined,
    classify_attempts: 0,
    ...held,
  };
}

const request = buildRequest({
  item: capture('dentist tomorrow at 3pm'),
  world,
  examples: [],
  timeZone: 'America/Chicago',
  now: new Date('2026-10-03T14:00:00-05:00'),
});
const schema = request.schema as { properties: Record<string, unknown>; required: string[] };
console.log(`prompt version ${String(PROMPT_VERSION)}`);
console.log('system prompt, due_time rule:');
console.log(`  ${request.system.split('\n').find((line) => line.startsWith('- due_time')) ?? ''}`);
console.log(`schema due_time: ${JSON.stringify(schema.properties['due_time'])}`);
console.log(`due_time required: ${String(schema.required.includes('due_time'))}`);
console.log('');

/** Run one model answer through parse → validate → merge, and print the PATCH it becomes. */
function judge(label: string, item: SweepItem, answer: Record<string, unknown>): void {
  const parsed = parseVerdict({
    item_type: 'task',
    priority: null,
    folder_id: null,
    intended_project_id: null,
    intended_epic_id: null,
    ...answer,
  });
  if (parsed === undefined) throw new Error('unparseable');
  const patch = mergeIntoItem(validateVerdict(parsed, world), item, world);
  console.log(`${label}`);
  console.log(`  answer: ${JSON.stringify(answer)}`);
  console.log(`  writes: ${JSON.stringify(patch)}`);
}

judge('"dentist tomorrow at 3pm"', capture('dentist tomorrow at 3pm'), {
  due_date: '2026-10-04',
  due_time: '15:00',
});
judge('"call mom tonight" (a part of day is not a time)', capture('call mom tonight'), {
  due_date: '2026-10-03',
  due_time: null,
});
judge('a time the model gave with no date', capture('stand-up at 9:30'), {
  due_date: null,
  due_time: '09:30',
});
judge('a malformed time', capture('pay rent by 5'), { due_date: '2026-10-03', due_time: '5pm' });
judge(
  'a time onto a row already holding that same date',
  capture('dentist at 3pm', { due_date: '2026-10-04T00:00:00+00:00' }),
  { due_date: '2026-10-04', due_time: '15:00' },
);
judge(
  'a time guessed for a different day than the one the owner set',
  capture('dentist at 3pm', { due_date: '2026-10-06T00:00:00+00:00' }),
  { due_date: '2026-10-04', due_time: '15:00' },
);
