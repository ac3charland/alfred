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

/** A roster with one high-priority person reachable at `priority@example.com`. */
function priorityRoster() {
  const person = makeCommPerson('Priority Pat', { priority: 'high' });
  return [{ ...person, comm_handles: [makeCommHandle(person.id, 'priority@example.com')] }];
}

/** A message carrying every chip at once, so the order is the only thing left to assert. */
function everything(overrides: Partial<ReturnType<typeof makeCommMessage>> = {}) {
  return makeCommMessage(ACCOUNT, {
    sender_handle: 'priority@example.com',
    reclassify_requested_at: NOW.toISOString(),
    judged_by: 'refusal',
    has_attachments: true,
    body: '',
    body_extracted: false,
    filtered_reason: 'newsletter',
    received_at: new Date(NOW.getTime() - 55 * MS_PER_DAY).toISOString(),
    ...overrides,
  });
}

describe('rowMarkerKinds', () => {
  it('lists a row’s chips in the order the row draws them', () => {
    expect(rowMarkerKinds(everything(), priorityRoster(), NOW, true)).toEqual([
      'rerun-pending',
      'priority',
      'attachment',
      'decode-failed',
      'expiry',
      'refused',
      'filtered',
    ]);
    expect(
      rowMarkerKinds(everything({ judged_by: 'unjudged' }), priorityRoster(), NOW, true),
    ).toContain('unjudged');
  });

  it('keeps refused and filtered to the shelf, where a queued row can never be either', () => {
    expect(rowMarkerKinds(everything(), priorityRoster(), NOW, false)).not.toContain('refused');
    expect(rowMarkerKinds(everything(), priorityRoster(), NOW, false)).not.toContain('filtered');
  });

  it('marks nothing on an ordinary row', () => {
    expect(rowMarkerKinds(makeCommMessage(ACCOUNT, { body: 'hi' }), [], NOW, true)).toEqual([]);
  });

  it('drops the expiry chip once the row has been cleared', () => {
    const cleared = everything({ cleared_at: NOW.toISOString(), cleared_by: 'not_replying' });
    expect(rowMarkerKinds(cleared, [], NOW, true)).not.toContain('expiry');
  });
});

describe('rollUpMarkers', () => {
  it('unions the chips across a conversation, counting the ones more than one message carries', () => {
    const refusedA = makeCommMessage(ACCOUNT, { judged_by: 'refusal', body: 'a' });
    const refusedB = makeCommMessage(ACCOUNT, { judged_by: 'refusal', body: 'b' });
    const attachment = makeCommMessage(ACCOUNT, { has_attachments: true, body: '' });

    expect(rollUpMarkers([refusedA, attachment, refusedB], [], NOW)).toEqual([
      { kind: 'attachment', count: 1 },
      { kind: 'refused', count: 2 },
    ]);
  });

  it('never counts the priority chip, which describes a sender rather than a message', () => {
    const one = makeCommMessage(ACCOUNT, { sender_handle: 'priority@example.com', body: 'a' });
    const two = makeCommMessage(ACCOUNT, { sender_handle: 'priority@example.com', body: 'b' });

    expect(rollUpMarkers([one, two], priorityRoster(), NOW)).toEqual([
      { kind: 'priority', count: 1 },
    ]);
  });

  it('leaves the expiry chip on the messages inside rather than rolling it up', () => {
    expect(rollUpMarkers([everything()], [], NOW).map((marker) => marker.kind)).not.toContain(
      'expiry',
    );
  });

  it('rolls up the shelf-only chips, since a conversation only ever sits on the shelf', () => {
    expect(rollUpMarkers([everything()], [], NOW).map((marker) => marker.kind)).toEqual([
      'rerun-pending',
      'attachment',
      'decode-failed',
      'refused',
      'filtered',
    ]);
  });
});
