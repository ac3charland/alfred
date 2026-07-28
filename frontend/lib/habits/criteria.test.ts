import {
  deriveDayStatus,
  evaluateCriterion,
  parseCriteria,
  parseResults,
} from '@/lib/habits/criteria';
import type { Comparator, HabitCriterion } from '@/lib/habits/types';

const WAKE: HabitCriterion = {
  key: 'wake',
  label: 'Up by 6:15',
  kind: 'time',
  target: 375,
  comparator: 'lte',
};
const LIGHT: HabitCriterion = { key: 'light', label: 'Outside for light', kind: 'boolean' };

function measured(kind: 'time' | 'count' | 'duration', comparator: Comparator): HabitCriterion {
  return { key: 'k', label: 'k', kind, target: 10, comparator };
}

describe('evaluateCriterion', () => {
  it('passes a boolean only when the stored value is true', () => {
    expect(evaluateCriterion(LIGHT, true)).toBe('pass');
    expect(evaluateCriterion(LIGHT, false)).toBe('fail');
  });

  it.each(['time', 'count', 'duration'] as const)('compares a %s against its target', (kind) => {
    expect(evaluateCriterion(measured(kind, 'lte'), 9)).toBe('pass');
    expect(evaluateCriterion(measured(kind, 'lte'), 11)).toBe('fail');
    expect(evaluateCriterion(measured(kind, 'gte'), 11)).toBe('pass');
    expect(evaluateCriterion(measured(kind, 'gte'), 9)).toBe('fail');
    expect(evaluateCriterion(measured(kind, 'eq'), 10)).toBe('pass');
    expect(evaluateCriterion(measured(kind, 'eq'), 11)).toBe('fail');
  });

  it('treats the boundary value as passing under lte and gte, and only equal under eq', () => {
    expect(evaluateCriterion(measured('count', 'lte'), 10)).toBe('pass');
    expect(evaluateCriterion(measured('count', 'gte'), 10)).toBe('pass');
    expect(evaluateCriterion(measured('count', 'eq'), 10)).toBe('pass');
  });

  it('reports a missing key as unrecorded, never as a failure', () => {
    expect(evaluateCriterion(LIGHT, undefined)).toBe('unrecorded');
    expect(evaluateCriterion(WAKE, undefined)).toBe('unrecorded');
  });

  it('reports a wrong-typed value as unrecorded', () => {
    // A boolean holding a number, or a measured criterion holding a boolean, is not evidence.
    expect(evaluateCriterion(LIGHT, 1)).toBe('unrecorded');
    expect(evaluateCriterion(WAKE, true)).toBe('unrecorded');
  });
});

describe('deriveDayStatus', () => {
  it('derives met when every criterion passes', () => {
    expect(deriveDayStatus([WAKE, LIGHT], { wake: 364, light: true })).toBe('met');
  });

  it('derives partial when some pass and some do not', () => {
    expect(deriveDayStatus([WAKE, LIGHT], { wake: 364, light: false })).toBe('partial');
    // An unrecorded criterion is simply not a pass — every criterion is required.
    expect(deriveDayStatus([WAKE, LIGHT], { wake: 364 })).toBe('partial');
  });

  it('derives missed when none pass', () => {
    expect(deriveDayStatus([WAKE, LIGHT], { wake: 700, light: false })).toBe('missed');
    expect(deriveDayStatus([WAKE, LIGHT], {})).toBe('missed');
  });

  it('never derives skipped — that status can only be stated by hand', () => {
    const statuses = [
      deriveDayStatus([LIGHT], { light: true }),
      deriveDayStatus([LIGHT], { light: false }),
      deriveDayStatus([LIGHT], {}),
    ];
    expect(statuses).not.toContain('skipped');
  });

  it('ignores an orphaned result key left behind by a deleted criterion', () => {
    expect(deriveDayStatus([LIGHT], { light: true, removed_criterion: false })).toBe('met');
  });

  it('cannot derive met from no criteria at all', () => {
    expect(deriveDayStatus([], { anything: true })).toBe('missed');
  });
});

describe('parseCriteria', () => {
  it('reads the criteria array a habit stores', () => {
    expect(parseCriteria([{ key: 'light', label: 'Outside for light', kind: 'boolean' }])).toEqual([
      LIGHT,
    ]);
    expect(
      parseCriteria([
        { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
      ]),
    ).toEqual([WAKE]);
  });

  it('drops an element that does not have the shape the route validates on write', () => {
    expect(
      parseCriteria([
        { key: 'ok', label: 'Fine', kind: 'boolean' },
        { key: 'bad', label: 'Missing a target', kind: 'count' },
        { key: 'worse', label: 'Unknown kind', kind: 'colour' },
        'not even an object',
        null,
      ]),
    ).toEqual([{ key: 'ok', label: 'Fine', kind: 'boolean' }]);
  });

  it('returns nothing for a blob that is not an array', () => {
    expect(parseCriteria({ key: 'light' })).toEqual([]);
    expect(parseCriteria(null)).toEqual([]);
  });
});

describe('parseResults', () => {
  it('keeps booleans and numbers, dropping anything else', () => {
    expect(parseResults({ light: true, wake: 364, junk: 'yes', nested: { a: 1 } })).toEqual({
      light: true,
      wake: 364,
    });
  });

  it('reads an absent or non-object blob as no results at all', () => {
    expect(parseResults(null)).toEqual({});
    expect(parseResults([1, 2])).toEqual({});
  });
});
