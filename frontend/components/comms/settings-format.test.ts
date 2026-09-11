import { makeCommCorrection, makeCommPerson, resetCommFixtureClock } from '@/lib/comms/fixtures';

import {
  PRIORITY_LABEL,
  PRIORITY_MEANING,
  PRIORITY_VALUES,
  exampleKindLabel,
  exampleSetVersion,
  formatSavedAt,
  personPriority,
  rubricFirstLine,
  tierTransition,
} from './settings-format';

beforeEach(() => {
  resetCommFixtureClock();
});

const NOW = new Date('2026-07-28T12:00:00.000Z');

describe('priority', () => {
  it('gives every priority a label and a one-line meaning', () => {
    for (const value of PRIORITY_VALUES) {
      expect(PRIORITY_LABEL[value]).not.toBe('');
      expect(PRIORITY_MEANING[value]).not.toBe('');
    }
  });

  it('reads a stored priority back', () => {
    expect(personPriority(makeCommPerson('Dana', { priority: 'low' }))).toBe('low');
  });

  it('falls back to normal for a value outside the three, so the card still renders', () => {
    // The column is a text CHECK, not an enum — a row could in principle hold anything.
    expect(personPriority(makeCommPerson('Dana', { priority: 'urgent' }))).toBe('normal');
  });
});

describe('formatSavedAt', () => {
  it('is relative while the edit is still fresh', () => {
    expect(formatSavedAt('2026-07-28T09:00:00.000Z', NOW)).toBe('3h ago');
  });

  it('becomes an ordinary date once it is not — days-ago is arithmetic, not an answer', () => {
    expect(formatSavedAt('2026-03-14T09:00:00.000Z', NOW)).toBe('Mar 14');
  });

  it('carries the year for a version from an earlier one', () => {
    expect(formatSavedAt('2020-03-14T09:00:00.000Z', NOW)).toBe('Mar 14, 2020');
  });

  it('says nothing at all for an unparseable stamp', () => {
    expect(formatSavedAt('not-a-date', NOW)).toBe('');
  });
});

describe('exampleSetVersion', () => {
  it('is zero before anything has been corrected', () => {
    expect(exampleSetVersion([])).toBe(0);
  });

  it('is the highest number ANY insert or prune has claimed', () => {
    const rows = [
      makeCommCorrection({ created_version: 2 }),
      // A prune bumps the set too, so the newest number can sit on an older row.
      makeCommCorrection({ created_version: 1, pruned_version: 5, pruned_at: 'x' }),
      makeCommCorrection({ created_version: 3 }),
    ];
    expect(exampleSetVersion(rows)).toBe(5);
  });
});

describe('the correction itself', () => {
  it('names which kind of correction it was', () => {
    expect(exampleKindLabel('nothing_to_answer')).toBe('Nothing to answer');
    expect(exampleKindLabel('tier_change')).toBe('Tier change');
  });

  it('reads as the move the owner made', () => {
    const correction = makeCommCorrection({ model_tier: 'asap', chosen_tier: 'fyi' });
    expect(tierTransition(correction)).toEqual({ from: 'ASAP', to: 'FYI' });
  });

  it('says a row with no verdict was unjudged rather than inventing a guess', () => {
    const correction = makeCommCorrection({ model_tier: null, chosen_tier: 'today' });
    expect(tierTransition(correction)).toEqual({ from: 'unjudged', to: 'Today' });
  });
});

describe('rubricFirstLine', () => {
  it('is what tells one version from another at a glance', () => {
    expect(rubricFirstLine('  Anything from my wife is ASAP.\nInvoices go to Today.  ')).toBe(
      'Anything from my wife is ASAP.',
    );
  });

  it('is empty for an empty body rather than undefined', () => {
    expect(rubricFirstLine(' '.repeat(3))).toBe('');
  });
});
