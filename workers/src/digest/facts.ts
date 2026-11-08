/**
 * Everything the digest renders, in one subrequest: `digest_facts(p_now, p_zone)`. The RPC only
 * selects — the Due ranking runs in `due.ts`, the plan is read in `plan.ts` — and its answer is
 * checked here against the shape the builder relies on, so a drifted RPC fails as one counted
 * attempt with a readable reason rather than as a digest built from `undefined`.
 */
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';
import type { DigestTaskRow } from './due';

/** One ask in the queue, as the RPC returns it: ASAP then Today, newest first, at most five. */
export interface DigestAsk {
  tier: 'asap' | 'today';
  sender: string | null;
  account: string | null;
  ask: string | null;
  received_at: string;
}

export interface DigestFacts {
  /** Every active task, plus any non-active direct parent of one. */
  tasks: DigestTaskRow[];
  comms: {
    counts: { asap: number; today: number; whenever: number };
    asks: DigestAsk[];
  };
  /** Reader posts not archived. */
  reader_waiting: number;
  /** The newest weekly plan, verbatim, or null when none was ever uploaded. */
  plan: { id: string; uploaded_at: string; html: string } | null;
}

type Guard = (value: unknown) => boolean;

const isString: Guard = (value) => typeof value === 'string';
const isCount: Guard = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const nullable =
  (guard: Guard): Guard =>
  (value) =>
    value === null || guard(value);
const oneOf =
  (...values: string[]): Guard =>
  (value) =>
    typeof value === 'string' && values.includes(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is an object whose named fields each pass their guard. */
function hasShape(value: unknown, shape: Record<string, Guard>): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(shape).every(([key, guard]) => guard(value[key]));
}

const TASK: Record<string, Guard> = {
  id: isString,
  parent_id: nullable(isString),
  title: isString,
  status: isString,
  priority: nullable(oneOf('high', 'medium', 'low')),
  due_date: nullable(isString),
  due_time: nullable(isString),
  created_at: isString,
};

const ASK: Record<string, Guard> = {
  tier: oneOf('asap', 'today'),
  sender: nullable(isString),
  account: nullable(isString),
  ask: nullable(isString),
  received_at: isString,
};

/** The first problem with an RPC answer, or undefined when it is a {@link DigestFacts}. */
export function factsProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'not an object';
  const { tasks, comms, reader_waiting: reader, plan } = value;
  if (!Array.isArray(tasks) || !tasks.every((row) => hasShape(row, TASK))) return 'bad tasks';
  if (!isRecord(comms)) return 'bad comms';
  if (!hasShape(comms['counts'], { asap: isCount, today: isCount, whenever: isCount })) {
    return 'bad comms counts';
  }
  const asks = comms['asks'];
  if (!Array.isArray(asks) || !asks.every((row) => hasShape(row, ASK))) return 'bad comms asks';
  if (!isCount(reader)) return 'bad reader_waiting';
  if (plan !== null && !hasShape(plan, { id: isString, uploaded_at: isString, html: isString })) {
    return 'bad plan';
  }
  return undefined;
}

/** Read the digest's facts at `now`, in `zone`. Throws on a failed call or a malformed answer. */
export async function digestFacts(env: SupabaseEnv, now: Date, zone: string): Promise<DigestFacts> {
  const value = await fetchJson<unknown>(
    env,
    restQueryUrl(env, 'rpc/digest_facts', {}),
    { method: 'POST', body: JSON.stringify({ p_now: now.toISOString(), p_zone: zone }) },
    'POST rpc/digest_facts',
  );
  const problem = factsProblem(value);
  if (problem !== undefined) throw new Error(`digest_facts answered off-shape: ${problem}`);
  return value as DigestFacts;
}
