import type { HabitCriterionInput, UpdateHabitInput } from '@/lib/api/schemas';
import {
  LOCKED_FIELDS,
  applyHabitUpdate,
  lockedFieldsChanged,
  lockedFieldsMessage,
} from '@/lib/habits/edits';
import type { Habit } from '@/lib/types';

const CRITERIA: HabitCriterionInput[] = [
  { key: 'wake', label: 'be up by', kind: 'time', target: 420, comparator: 'lte' },
];

const HABIT: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: CRITERIA,
  active_days: [1, 2, 3, 4, 5],
  allowance: 1,
  started_on: '2026-06-12',
  archived_at: null,
  sort_order: null,
  created_at: '2026-06-12T08:00:00Z',
};

const NOW = '2026-07-30T09:00:00Z';

describe('lockedFieldsChanged', () => {
  it('names no field for a body that only touches the editable ones', () => {
    expect(
      lockedFieldsChanged(HABIT, { name: 'Renamed', criteria: CRITERIA, notes: 'a note' }),
    ).toStrictEqual([]);
  });

  it('names no field for an empty body', () => {
    expect(lockedFieldsChanged(HABIT, {})).toStrictEqual([]);
  });

  it.each<[string, UpdateHabitInput]>([
    ['active_days', { active_days: [1, 2, 3, 4, 5] }],
    ['allowance', { allowance: 1 }],
    ['started_on', { started_on: '2026-06-12' }],
  ])('treats %s resent with the value it already has as no change', (_field, input) => {
    expect(lockedFieldsChanged(HABIT, input)).toStrictEqual([]);
  });

  it.each<[string, UpdateHabitInput]>([
    ['active_days', { active_days: [1, 2, 3] }],
    ['allowance', { allowance: 2 }],
    ['started_on', { started_on: '2026-05-01' }],
  ])('names %s when it actually changes', (field, input) => {
    expect(lockedFieldsChanged(HABIT, input)).toStrictEqual([field]);
  });

  it('names every locked field a body changes at once, in a stable order', () => {
    expect(
      lockedFieldsChanged(HABIT, {
        active_days: [1, 2],
        allowance: 4,
        started_on: '2026-01-01',
        name: 'Renamed',
      }),
    ).toStrictEqual([...LOCKED_FIELDS]);
  });

  // active_days is a SET of weekdays: the column stores an order, but the cadence it means is
  // order-free, so a form that rebuilt the array must not read as a change.
  it('compares active_days as a set, so a reorder is not a change', () => {
    expect(lockedFieldsChanged(HABIT, { active_days: [5, 3, 1, 4, 2] })).toStrictEqual([]);
  });

  it('names active_days when the membership differs at the same length', () => {
    expect(lockedFieldsChanged(HABIT, { active_days: [1, 2, 3, 4, 6] })).toStrictEqual([
      'active_days',
    ]);
  });

  it('names active_days when a weekday repeats to pad the same length', () => {
    expect(lockedFieldsChanged(HABIT, { active_days: [1, 2, 3, 4, 4] })).toStrictEqual([
      'active_days',
    ]);
  });
});

describe('lockedFieldsMessage', () => {
  it('names the field, the habit and the number of days at stake', () => {
    expect(lockedFieldsMessage(['allowance'], 'Morning routine', 63)).toBe(
      'allowance is fixed once a habit has history — Morning routine has 63 logged days',
    );
  });

  it('agrees the verb with more than one field', () => {
    expect(lockedFieldsMessage(['allowance', 'started_on'], 'Morning routine', 63)).toBe(
      'allowance and started_on are fixed once a habit has history — Morning routine has 63 logged days',
    );
  });

  it('reads three fields as a list rather than a chain of ands', () => {
    expect(lockedFieldsMessage([...LOCKED_FIELDS], 'Morning routine', 63)).toBe(
      'active_days, allowance and started_on are fixed once a habit has history — Morning routine has 63 logged days',
    );
  });

  it('says one logged day in the singular', () => {
    expect(lockedFieldsMessage(['active_days'], 'Cold shower', 1)).toBe(
      'active_days is fixed once a habit has history — Cold shower has 1 logged day',
    );
  });
});

describe('applyHabitUpdate', () => {
  it('leaves every column alone for a body with no keys', () => {
    expect(applyHabitUpdate(HABIT, {}, NOW)).toStrictEqual(HABIT);
  });

  it('applies only the fields the body carries', () => {
    expect(applyHabitUpdate(HABIT, { name: 'Renamed' }, NOW)).toStrictEqual({
      ...HABIT,
      name: 'Renamed',
    });
  });

  it('replaces the criteria wholesale', () => {
    const next: HabitCriterionInput[] = [
      { key: 'wake', label: 'be up by', kind: 'time', target: 375, comparator: 'lte' },
    ];
    expect(applyHabitUpdate(HABIT, { criteria: next }, NOW).criteria).toStrictEqual(next);
  });

  it('clears notes when the body sends null', () => {
    expect(applyHabitUpdate({ ...HABIT, notes: 'a note' }, { notes: null }, NOW).notes).toBeNull();
  });

  it('applies the cadence fields, which are legal on a habit with no history', () => {
    expect(
      applyHabitUpdate(HABIT, { active_days: [1, 2], allowance: 3, started_on: '2026-07-01' }, NOW),
    ).toStrictEqual({
      ...HABIT,
      active_days: [1, 2],
      allowance: 3,
      started_on: '2026-07-01',
    });
  });

  it('stamps archived_at from the boolean rather than from a caller-supplied instant', () => {
    expect(applyHabitUpdate(HABIT, { archived: true }, NOW).archived_at).toBe(NOW);
  });

  it('clears archived_at when archived is false', () => {
    expect(
      applyHabitUpdate({ ...HABIT, archived_at: NOW }, { archived: false }, NOW).archived_at,
    ).toBeNull();
  });

  it('leaves archived_at alone when the body never mentions archived', () => {
    expect(
      applyHabitUpdate({ ...HABIT, archived_at: NOW }, { name: 'Renamed' }, NOW).archived_at,
    ).toBe(NOW);
  });
});
