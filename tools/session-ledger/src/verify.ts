import { verifiedFields } from './records.ts';
import { byString, sortedBy } from './sort.ts';
import type { JsonObject } from './types.ts';

/**
 * Fidelity for the one non-deterministic step: subagents copy session records into NDJSON, so the
 * lead re-fetches a random sample itself and every field the ledger derives from must match.
 */

/** max(`min`, `pct`% of the ids), capped at how many there are, drawn without replacement. */
export function sampleIds(
  ids: readonly string[],
  { pct, min }: { pct: number; min: number },
  random: () => number = Math.random,
): string[] {
  const count = Math.min(ids.length, Math.max(min, Math.ceil((ids.length * pct) / 100)));
  const pool = [...ids];
  // A partial Fisher–Yates shuffle: the first `count` slots end up a uniform sample.
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j] ?? '', pool[i] ?? ''];
  }
  return pool.slice(0, count);
}

/** JSON with object keys sorted, so two equal values compare equal as strings. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = sortedBy(Object.entries(value), ([a], [b]) => byString(a, b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

export interface Mismatch {
  id: string;
  field: string;
}

/** Every verified field where a subagent's copy differs from the lead's re-fetch. */
export function verifyRecords(
  copies: readonly JsonObject[],
  refetched: readonly JsonObject[],
): Mismatch[] {
  const byId = new Map(copies.map((record) => [String(record['id']), record]));
  const mismatches: Mismatch[] = [];
  for (const fresh of refetched) {
    const id = String(fresh['id']);
    const copy = byId.get(id);
    if (copy === undefined) {
      mismatches.push({ id, field: 'missing from the subagent copies' });
      continue;
    }
    const expected = verifiedFields(fresh);
    const actual = verifiedFields(copy);
    for (const field of Object.keys(expected)) {
      if (canonical(expected[field]) !== canonical(actual[field])) mismatches.push({ id, field });
    }
  }
  return mismatches;
}
