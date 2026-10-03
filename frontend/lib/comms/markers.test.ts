import type { CommPersonWithHandles } from '@/lib/types';

import { makeCommHandle, makeCommMessage, makeCommPerson, resetCommFixtureClock } from './fixtures';
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

/** A roster holding one priority person, reachable at `vip@example.com`. */
function priorityRoster(): CommPersonWithHandles[] {
  const person = makeCommPerson('Vip', { priority: 'high' });
  return [{ ...person, comm_handles: [makeCommHandle(person.id, 'vip@example.com')] }];
}

describe('rowMarkerKinds', () => {
  it('lists every marker a row carries, in the order the row draws them', () => {
    const everything = makeCommMessage(ACCOUNT, {
      sender_handle: 'vip@example.com',
      reclassify_requested_at: NOW.toISOString(),
      judged_by: 'refusal',
      has_attachments: true,
      body: '',
      body_extracted: false,
      filtered_reason: 'newsletter',
      received_at: new Date(NOW.getTime() - 55 * MS_PER_DAY).toISOString(),
    });

    expect(rowMarkerKinds(everything, priorityRoster(), NOW, true)).toEqual([
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

  it('keeps refused and filtered off a queued row — only the shelf carries them', () => {
    const row = makeCommMessage(ACCOUNT, { judged_by: 'refusal', filtered_reason: 'list' });
    expect(rowMarkerKinds(row, [], NOW, false)).toEqual([]);
  });

  it('drops the expiry marker from a cleared row', () => {
    const row = makeCommMessage(ACCOUNT, {
      received_at: new Date(NOW.getTime() - 55 * MS_PER_DAY).toISOString(),
      cleared_at: NOW.toISOString(),
    });
    expect(rowMarkerKinds(row, [], NOW, true)).toEqual([]);
  });
});

describe('rollUpMarkers', () => {
  it('counts each marker across the messages, in row order', () => {
    const messages = [
      makeCommMessage(ACCOUNT, { judged_by: 'refusal' }),
      makeCommMessage(ACCOUNT, { has_attachments: true, body: '' }),
      makeCommMessage(ACCOUNT, { has_attachments: true, body: '', judged_by: 'refusal' }),
      makeCommMessage(ACCOUNT),
    ];

    expect(rollUpMarkers(messages, [], NOW)).toEqual([
      { kind: 'attachment', count: 2 },
      { kind: 'refused', count: 2 },
    ]);
  });

  it('leaves the expiry marker on the messages — it would sit on every old conversation', () => {
    const messages = [aged(56), aged(1)];
    expect(rollUpMarkers(messages, [], NOW)).toEqual([]);
  });

  it('never counts the priority marker, which describes a sender rather than messages', () => {
    const fromVip = { sender_handle: 'vip@example.com' };
    const messages = [makeCommMessage(ACCOUNT, fromVip), makeCommMessage(ACCOUNT, fromVip)];

    expect(rollUpMarkers(messages, priorityRoster(), NOW)).toEqual([
      { kind: 'priority', count: 1 },
    ]);
  });
});
