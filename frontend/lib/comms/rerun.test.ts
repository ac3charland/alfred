import type { CommMessage } from '@/lib/types';

import { makeCommMessage } from './fixtures';
import { type RerunBefore, isReclassifyPending, rerunOutcomeMessage } from './rerun';

const ACCOUNT = '00000000-0000-4000-8000-00000000000a';

/** The row as the sweep left it once the request cleared. */
function resolved(overrides: Partial<CommMessage> = {}): CommMessage {
  return makeCommMessage(ACCOUNT, {
    tier: 'today',
    judged_by: 'model',
    reclassify_requested_at: null,
    ...overrides,
  });
}

const REQUESTED_AT = '2026-09-09T14:50:00.000Z';
const before = (tier: RerunBefore['tier']): RerunBefore => ({ tier, requestedAt: REQUESTED_AT });

describe('isReclassifyPending', () => {
  it('is pending exactly while a request stands on the row', () => {
    expect(
      isReclassifyPending(makeCommMessage(ACCOUNT, { reclassify_requested_at: REQUESTED_AT })),
    ).toBe(true);
    expect(isReclassifyPending(makeCommMessage(ACCOUNT, { reclassify_requested_at: null }))).toBe(
      false,
    );
  });

  it('is not pending for a row whose re-run failed: the request was given up on', () => {
    expect(
      isReclassifyPending(
        makeCommMessage(ACCOUNT, {
          reclassify_requested_at: null,
          reclassify_failed_at: '2026-09-09T15:10:00.000Z',
        }),
      ),
    ).toBe(false);
  });
});

describe('rerunOutcomeMessage', () => {
  describe('when the verdict changed', () => {
    it('names the tier it left and the tier it landed on', () => {
      expect(
        rerunOutcomeMessage(before('today'), resolved({ tier: 'asap' }), 'Dana Whitfield'),
      ).toBe('Re-run · Dana Whitfield: Today → ASAP');
    });

    it('says a row with no tier before was unjudged', () => {
      expect(rerunOutcomeMessage(before(null), resolved({ tier: 'whenever' }), 'Sam Ortiz')).toBe(
        'Re-run · Sam Ortiz: Unjudged → Whenever',
      );
    });

    it('reports a demotion to FYI as a change like any other', () => {
      expect(
        rerunOutcomeMessage(before('today'), resolved({ tier: 'fyi' }), 'Dana Whitfield'),
      ).toBe('Re-run · Dana Whitfield: Today → FYI');
    });
  });

  describe('when the verdict did not change', () => {
    it.each([
      ['asap', 'ASAP'],
      ['today', 'Today'],
      ['whenever', 'Whenever'],
      ['fyi', 'FYI'],
    ] as const)('says it is still %s', (tier, label) => {
      expect(rerunOutcomeMessage(before(tier), resolved({ tier }), 'Dana Whitfield')).toBe(
        `Re-run · Dana Whitfield: still ${label}`,
      );
    });
  });

  describe('when the model declined', () => {
    it('says so and where the row went', () => {
      expect(
        rerunOutcomeMessage(
          before('today'),
          resolved({ tier: 'fyi', judged_by: 'refusal' }),
          'Promo Weekly',
        ),
      ).toBe('Re-run · Promo Weekly: the model declined, moved to FYI');
    });
  });

  describe('when it still could not be judged', () => {
    it('says so and which tier it was left on', () => {
      expect(
        rerunOutcomeMessage(
          before(null),
          resolved({ tier: 'today', judged_by: 'unjudged' }),
          'Sam Ortiz',
        ),
      ).toBe("Re-run · Sam Ortiz: still couldn't judge it, on Today");
    });
  });

  describe('when the worker gave up', () => {
    const failedAfter = { reclassify_failed_at: '2026-09-09T15:00:00.000Z' };

    it('says the re-run failed and which tier the row kept', () => {
      expect(
        rerunOutcomeMessage(before('today'), resolved({ ...failedAfter }), 'Dana Whitfield'),
      ).toBe('Re-run failed · Dana Whitfield: kept Today');
    });

    it('says the row is still unjudged when it had no tier to keep', () => {
      // The park that follows an abandoned row with no tier files it on Today in the same tick,
      // so the row's own tier would read as "kept Today" — which it never had.
      expect(
        rerunOutcomeMessage(
          before(null),
          resolved({ ...failedAfter, judged_by: 'unjudged', tier: 'today' }),
          'Sam Ortiz',
        ),
      ).toBe('Re-run failed · Sam Ortiz: still unjudged');
    });

    it('counts a failure stamped at the very instant of the request', () => {
      expect(
        rerunOutcomeMessage(
          before('today'),
          resolved({ reclassify_failed_at: REQUESTED_AT }),
          'Dana Whitfield',
        ),
      ).toBe('Re-run failed · Dana Whitfield: kept Today');
    });

    it('ignores a failure from before this request: it describes an earlier one', () => {
      expect(
        rerunOutcomeMessage(
          before('today'),
          resolved({ reclassify_failed_at: '2026-09-09T14:49:59.999Z', tier: 'asap' }),
          'Dana Whitfield',
        ),
      ).toBe('Re-run · Dana Whitfield: Today → ASAP');
    });

    it('compares the two stamps as instants, not as strings', () => {
      // The database writes `+00:00` and microseconds, the client `Z` and milliseconds. Agreeing to
      // the millisecond, the failure is the same instant as the request and so counts — but as
      // text `…00.123456+00:00` sorts BEFORE `…00.123Z`, so a string comparison calls it older
      // and reports the wrong outcome.
      expect(
        rerunOutcomeMessage(
          { tier: 'today', requestedAt: '2026-09-09T14:50:00.123Z' },
          resolved({ reclassify_failed_at: '2026-09-09T14:50:00.123456+00:00' }),
          'Dana Whitfield',
        ),
      ).toBe('Re-run failed · Dana Whitfield: kept Today');
    });
  });

  describe('precedence: the first rule that matches wins', () => {
    const failed = { reclassify_failed_at: '2026-09-09T15:00:00.000Z' };

    it('a failure beats a refusal', () => {
      expect(
        rerunOutcomeMessage(
          before('today'),
          resolved({ ...failed, judged_by: 'refusal', tier: 'fyi' }),
          'Dana',
        ),
      ).toBe('Re-run failed · Dana: kept FYI');
    });

    it('a failure beats a row that could not be judged', () => {
      expect(
        rerunOutcomeMessage(
          before('today'),
          resolved({ ...failed, judged_by: 'unjudged' }),
          'Dana',
        ),
      ).toBe('Re-run failed · Dana: kept Today');
    });

    it('a refusal beats an unchanged tier', () => {
      expect(
        rerunOutcomeMessage(
          before('fyi'),
          resolved({ tier: 'fyi', judged_by: 'refusal' }),
          'Promo Weekly',
        ),
      ).toBe('Re-run · Promo Weekly: the model declined, moved to FYI');
    });

    it('being unable to judge beats an unchanged tier', () => {
      expect(
        rerunOutcomeMessage(
          before('today'),
          resolved({ tier: 'today', judged_by: 'unjudged' }),
          'Sam Ortiz',
        ),
      ).toBe("Re-run · Sam Ortiz: still couldn't judge it, on Today");
    });

    it('an unchanged tier beats a change', () => {
      expect(rerunOutcomeMessage(before('asap'), resolved({ tier: 'asap' }), 'Dana')).toBe(
        'Re-run · Dana: still ASAP',
      );
    });
  });
});
