import { makeCommMessage, resetCommFixtureClock } from './fixtures';
import {
  EXPIRY_WARNING_DAYS,
  RETENTION_DAYS,
  attachmentNotRead,
  decodeFailed,
  expiresSoon,
  isFiltered,
  isRefused,
  isUnjudged,
  rollUpMarkers,
  rowMarkerKinds,
} from './markers';

const ACCOUNT = '00000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A message that arrived `age` days before {@link NOW}. */
function aged(age: number): ReturnType<typeof makeCommMessage> {
  return makeCommMessage(ACCOUNT, {
    received_at: new Date(NOW.getTime() - age * MS_PER_DAY).toISOString(),
  });
}

beforeEach(() => {
  resetCommFixtureClock();
});

describe('expiresSoon', () => {
  it('leaves a fresh row unmarked', () => {
    expect(expiresSoon(aged(3), NOW)).toEqual({ soon: false, daysUntilDeletion: 57 });
  });

  it('marks a row once the sweep is within its last week', () => {
    expect(expiresSoon(aged(55), NOW)).toEqual({ soon: true, daysUntilDeletion: 5 });
  });

  it('marks the exact boundary — the warning window is inclusive', () => {
    const boundary = aged(RETENTION_DAYS - EXPIRY_WARNING_DAYS);
    expect(expiresSoon(boundary, NOW).soon).toBe(true);
    expect(expiresSoon(aged(RETENTION_DAYS - EXPIRY_WARNING_DAYS - 1), NOW).soon).toBe(false);
  });

  it('rounds down, so the marker never promises more time than remains', () => {
    // 54.5 days old → 5.5 days left; the row is told it has 5.
    const half = makeCommMessage(ACCOUNT, {
      received_at: new Date(NOW.getTime() - 54.5 * MS_PER_DAY).toISOString(),
    });
    expect(expiresSoon(half, NOW).daysUntilDeletion).toBe(5);
  });

  it('reports a past-due row with a negative count', () => {
    expect(expiresSoon(aged(63), NOW).daysUntilDeletion).toBe(-3);
  });
});

describe('the can-not-judge markers', () => {
  it('flags a row that hit the classification ceiling', () => {
    expect(isUnjudged(makeCommMessage(ACCOUNT, { judged_by: 'unjudged' }))).toBe(true);
    expect(isUnjudged(makeCommMessage(ACCOUNT, { judged_by: 'model' }))).toBe(false);
  });

  it('flags a model refusal', () => {
    expect(isRefused(makeCommMessage(ACCOUNT, { judged_by: 'refusal' }))).toBe(true);
    expect(isRefused(makeCommMessage(ACCOUNT, { judged_by: 'filter' }))).toBe(false);
  });

  it('flags a row the header filter shelved rather than the model', () => {
    expect(isFiltered(makeCommMessage(ACCOUNT, { filtered_reason: 'newsletter' }))).toBe(true);
    expect(isFiltered(makeCommMessage(ACCOUNT))).toBe(false);
  });

  it('flags an attachment with no readable text beside it', () => {
    expect(
      attachmentNotRead(makeCommMessage(ACCOUNT, { has_attachments: true, body: '  \n' })),
    ).toBe(true);
    expect(
      attachmentNotRead(makeCommMessage(ACCOUNT, { has_attachments: true, body: 'Look at this' })),
    ).toBe(false);
    expect(attachmentNotRead(makeCommMessage(ACCOUNT, { body: '' }))).toBe(false);
  });

  it('flags a body that never decoded', () => {
    expect(decodeFailed(makeCommMessage(ACCOUNT, { body_extracted: false }))).toBe(true);
    expect(decodeFailed(makeCommMessage(ACCOUNT))).toBe(false);
  });
});

describe('rowMarkerKinds', () => {
  const PRIORITY = {
    id: 'p1',
    name: 'Dana',
    priority: 'high' as const,
    notes: null,
    created_at: NOW.toISOString(),
    comm_handles: [
      {
        id: 'h1',
        person_id: 'p1',
        handle: 'dana@example.com',
        kind: 'email' as const,
        created_at: NOW.toISOString(),
      },
    ],
  };

  it('lists every chip a row carries, in drawing order', () => {
    const everything = makeCommMessage(ACCOUNT, {
      sender_handle: 'dana@example.com',
      reclassify_requested_at: NOW.toISOString(),
      judged_by: 'refusal',
      filtered_reason: 'list-unsubscribe',
      has_attachments: true,
      body: '',
      body_extracted: false,
      received_at: new Date(NOW.getTime() - (RETENTION_DAYS - 1) * MS_PER_DAY).toISOString(),
    });

    expect(rowMarkerKinds(everything, [PRIORITY], NOW, true)).toEqual([
      'rerun-pending',
      'priority',
      'attachment',
      'decode-failed',
      'expiry',
      'refused',
      'filtered',
    ]);
    expect(
      rowMarkerKinds(makeCommMessage(ACCOUNT, { judged_by: 'unjudged' }), [], NOW, false),
    ).toEqual(['unjudged']);
  });

  it('never marks a queued row refused or filtered', () => {
    const row = makeCommMessage(ACCOUNT, { judged_by: 'refusal', filtered_reason: 'bulk' });

    expect(rowMarkerKinds(row, [], NOW, false)).toEqual([]);
  });

  describe('rollUpMarkers', () => {
    it('counts each chip across a conversation, priority uncounted, expiry dropped', () => {
      const old = new Date(NOW.getTime() - (RETENTION_DAYS - 1) * MS_PER_DAY).toISOString();
      const messages = [
        makeCommMessage(ACCOUNT, { sender_handle: 'dana@example.com', judged_by: 'refusal' }),
        makeCommMessage(ACCOUNT, { sender_handle: 'dana@example.com', received_at: old }),
        makeCommMessage(ACCOUNT, { has_attachments: true, body: '', judged_by: 'refusal' }),
        makeCommMessage(ACCOUNT, { has_attachments: true, body: '', received_at: old }),
      ];

      expect(rollUpMarkers(messages, [PRIORITY], NOW)).toEqual([
        { kind: 'priority', count: 1 },
        { kind: 'attachment', count: 2 },
        { kind: 'refused', count: 2 },
      ]);
    });
  });
});
