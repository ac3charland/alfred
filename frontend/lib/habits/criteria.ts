import type { Json } from '@/lib/database.types';
import type {
  Comparator,
  CriterionKind,
  DerivedStatus,
  HabitCriterion,
  HabitResults,
} from '@/lib/habits/types';

/**
 * Scoring one day against a habit's criteria.
 *
 * Evaluation always iterates the CRITERIA and looks each key up in the results, never the
 * other way round — so a criterion deleted later leaves stale keys in old rows that are simply
 * never read. There is no referential integrity between the two jsonb blobs by design, and
 * that read order is what makes the absence safe.
 */

const MEASURED_KINDS = new Set<CriterionKind>(['time', 'count', 'duration']);
const COMPARATORS = new Set<Comparator>(['lte', 'gte', 'eq']);

/**
 * Read one criterion out of a stored jsonb element, or `undefined` when it doesn't have the
 * shape the route validates on write. The route's zod schema is the gate; this is the reader's
 * tolerance, so one malformed element can't blank a whole habit.
 */
function toCriterion(value: Json): HabitCriterion | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { key, label, kind, target, comparator } = value;
  if (typeof key !== 'string' || typeof label !== 'string' || typeof kind !== 'string') {
    return undefined;
  }
  if (kind === 'boolean') return { key, label, kind };
  if (!MEASURED_KINDS.has(kind as CriterionKind)) return undefined;
  if (typeof target !== 'number' || typeof comparator !== 'string') return undefined;
  if (!COMPARATORS.has(comparator as Comparator)) return undefined;
  return {
    key,
    label,
    kind: kind as 'time' | 'count' | 'duration',
    target,
    comparator: comparator as Comparator,
  };
}

/** The habit's criteria list, read out of the `criteria` jsonb column. */
export function parseCriteria(value: Json): HabitCriterion[] {
  if (!Array.isArray(value)) return [];
  const criteria: HabitCriterion[] = [];
  for (const element of value) {
    const criterion = toCriterion(element);
    if (criterion !== undefined) criteria.push(criterion);
  }
  return criteria;
}

/** One entry's recorded values, read out of the `results` jsonb column. */
export function parseResults(value: Json | null): HabitResults {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const results: HabitResults = {};
  for (const [key, recorded] of Object.entries(value)) {
    if (typeof recorded === 'boolean' || typeof recorded === 'number') results[key] = recorded;
  }
  return results;
}

/**
 * Score one criterion against its recorded value. `unrecorded` (rather than `fail`) when the
 * key is absent or the stored value doesn't match the kind — the day editor needs that third
 * outcome so an untouched criterion renders as an empty field, not a ✕.
 */
export function evaluateCriterion(
  criterion: HabitCriterion,
  value: boolean | number | undefined,
): 'pass' | 'fail' | 'unrecorded' {
  if (criterion.kind === 'boolean') {
    if (typeof value !== 'boolean') return 'unrecorded';
    return value ? 'pass' : 'fail';
  }
  if (typeof value !== 'number') return 'unrecorded';
  if (criterion.comparator === 'lte') return value <= criterion.target ? 'pass' : 'fail';
  if (criterion.comparator === 'gte') return value >= criterion.target ? 'pass' : 'fail';
  return value === criterion.target ? 'pass' : 'fail';
}

/**
 * The day's verdict: all criteria pass → `met`, some pass → `partial`, none pass → `missed`.
 * Every criterion is required, so an unrecorded one is simply not a pass. A habit with no
 * readable criteria can't be met, so it derives `missed` rather than vacuously `met`.
 */
export function deriveDayStatus(criteria: HabitCriterion[], results: HabitResults): DerivedStatus {
  let passes = 0;
  for (const criterion of criteria) {
    if (evaluateCriterion(criterion, results[criterion.key]) === 'pass') passes += 1;
  }
  if (criteria.length === 0 || passes === 0) return 'missed';
  return passes === criteria.length ? 'met' : 'partial';
}
