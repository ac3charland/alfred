import { makeCommMessage, resetCommFixtureClock } from './fixtures';
import { groupByTier, isQueued, isShelved, queueCount, readerClaimedCount, shelved } from './queue';

const ACCOUNT = '00000000-0000-4000-8000-00000000000a';

beforeEach(() => {
  resetCommFixtureClock();
});

describe('isQueued', () => {
  it('queues an uncleared inbound message in each of the three counted tiers', () => {
    for (const tier of ['asap', 'today', 'whenever'] as const) {
      expect(isQueued(makeCommMessage(ACCOUNT, { tier, judged_by: 'model' }))).toBe(true);
    }
  });

  it('does not queue the FYI shelf', () => {
    expect(isQueued(makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'model' }))).toBe(false);
  });

  it('does not queue a message that has not been judged yet', () => {
    expect(isQueued(makeCommMessage(ACCOUNT))).toBe(false);
  });

  it('does not queue a cleared message, whichever exit it left by', () => {
    for (const exit of ['reply', 'nothing_to_answer', 'not_replying', 'inbox_item']) {
      const message = makeCommMessage(ACCOUNT, {
        tier: 'today',
        judged_by: 'model',
        cleared_at: '2026-02-01T09:00:00.000Z',
        cleared_by: exit,
      });
      expect(isQueued(message)).toBe(false);
    }
  });

  it('never queues an outbound message — it is mirrored only as the drain signal', () => {
    const sent = makeCommMessage(ACCOUNT, {
      direction: 'outbound',
      tier: 'asap',
      judged_by: 'model',
    });
    expect(isQueued(sent)).toBe(false);
  });
});

describe('isShelved', () => {
  it('shelves a judged FYI message', () => {
    expect(isShelved(makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'model' }))).toBe(true);
  });

  it('shelves a message that left the queue by one of its exits', () => {
    const cleared = makeCommMessage(ACCOUNT, {
      tier: 'today',
      judged_by: 'model',
      cleared_at: '2026-02-01T09:00:00.000Z',
      cleared_by: 'reply',
    });
    expect(isShelved(cleared)).toBe(true);
  });

  it('leaves an unjudged message in neither the queue nor the shelf', () => {
    const waiting = makeCommMessage(ACCOUNT);
    expect(isQueued(waiting)).toBe(false);
    expect(isShelved(waiting)).toBe(false);
  });

  it('does not shelve a newsletter the Reader has claimed — it has a better home', () => {
    const claimed = makeCommMessage(ACCOUNT, {
      tier: 'fyi',
      judged_by: 'filter',
      filtered_reason: 'newsletter',
      reader_claimed_at: '2026-02-01T09:05:00.000Z',
    });
    expect(isShelved(claimed)).toBe(false);
    expect(shelved([claimed])).toEqual([]);
  });

  it('still queues a claimed message that owes a reply — the Reader hides an archive, never an obligation', () => {
    const claimedButQueued = makeCommMessage(ACCOUNT, {
      tier: 'today',
      judged_by: 'model',
      reader_claimed_at: '2026-02-01T09:05:00.000Z',
    });
    expect(isQueued(claimedButQueued)).toBe(true);
    expect(queueCount([claimedButQueued])).toBe(1);
  });

  it('does not shelve a queued message, or anything outbound', () => {
    expect(isShelved(makeCommMessage(ACCOUNT, { tier: 'asap', judged_by: 'model' }))).toBe(false);
    expect(
      isShelved(
        makeCommMessage(ACCOUNT, { direction: 'outbound', tier: 'fyi', judged_by: 'model' }),
      ),
    ).toBe(false);
  });
});

describe('groupByTier', () => {
  it('splits the queue into its three tiers, newest first', () => {
    const older = makeCommMessage(ACCOUNT, {
      tier: 'today',
      judged_by: 'model',
      received_at: '2026-02-01T08:00:00.000Z',
    });
    const newer = makeCommMessage(ACCOUNT, {
      tier: 'today',
      judged_by: 'model',
      received_at: '2026-02-01T09:30:00.000Z',
    });
    const urgent = makeCommMessage(ACCOUNT, { tier: 'asap', judged_by: 'model' });
    const undated = makeCommMessage(ACCOUNT, { tier: 'whenever', judged_by: 'model' });

    const grouped = groupByTier([older, urgent, newer, undated]);

    expect(grouped.asap).toEqual([urgent]);
    expect(grouped.today).toEqual([newer, older]);
    expect(grouped.whenever).toEqual([undated]);
  });

  it('drops everything the queue does not hold', () => {
    const grouped = groupByTier([
      makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'model' }),
      makeCommMessage(ACCOUNT),
      makeCommMessage(ACCOUNT, {
        tier: 'asap',
        judged_by: 'model',
        cleared_at: '2026-02-01T09:00:00.000Z',
        cleared_by: 'reply',
      }),
    ]);

    expect(grouped).toEqual({ asap: [], today: [], whenever: [] });
  });
});

describe('shelved', () => {
  it('returns the judged-but-unqueued messages newest first', () => {
    const older = makeCommMessage(ACCOUNT, {
      tier: 'fyi',
      judged_by: 'model',
      received_at: '2026-02-01T07:00:00.000Z',
    });
    const newer = makeCommMessage(ACCOUNT, {
      tier: 'fyi',
      judged_by: 'filter',
      filtered_reason: 'newsletter',
      received_at: '2026-02-01T11:00:00.000Z',
    });
    const queued = makeCommMessage(ACCOUNT, { tier: 'asap', judged_by: 'model' });

    expect(shelved([older, queued, newer])).toEqual([newer, older]);
  });
});

describe('queueCount', () => {
  it('counts the three tiers together and ignores the shelf', () => {
    const messages = [
      makeCommMessage(ACCOUNT, { tier: 'asap', judged_by: 'model' }),
      makeCommMessage(ACCOUNT, { tier: 'today', judged_by: 'model' }),
      makeCommMessage(ACCOUNT, { tier: 'whenever', judged_by: 'model' }),
      makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'model' }),
      makeCommMessage(ACCOUNT),
    ];

    expect(queueCount(messages)).toBe(3);
  });

  it('is zero for an empty module — the resting state', () => {
    expect(queueCount([])).toBe(0);
  });
});

describe('readerClaimedCount', () => {
  it('counts inbound messages the Reader claimed and nothing else', () => {
    const claimed = makeCommMessage(ACCOUNT, {
      tier: 'fyi',
      judged_by: 'filter',
      reader_claimed_at: '2026-02-01T09:05:00.000Z',
    });
    const unclaimed = makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'filter' });
    const outbound = makeCommMessage(ACCOUNT, {
      direction: 'outbound',
      reader_claimed_at: '2026-02-01T09:05:00.000Z',
    });
    expect(readerClaimedCount([claimed, unclaimed, outbound])).toBe(1);
    expect(readerClaimedCount([])).toBe(0);
  });

  it('does not count a claimed message that still owes a reply', () => {
    // The line reads "n went to the Reader" on the SHELF, so it counts what the shelf would
    // otherwise have shown. A queued newsletter never left the queue for the reading list.
    const queued = makeCommMessage(ACCOUNT, {
      tier: 'today',
      judged_by: 'model',
      reader_claimed_at: '2026-02-01T09:05:00.000Z',
    });

    expect(readerClaimedCount([queued])).toBe(0);
  });

  it('does not count a claimed message nothing has judged yet', () => {
    const unjudged = makeCommMessage(ACCOUNT, {
      reader_claimed_at: '2026-02-01T09:05:00.000Z',
    });

    expect(readerClaimedCount([unjudged])).toBe(0);
  });
});
