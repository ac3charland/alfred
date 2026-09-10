import {
  BACKLOG_MAX_AGE_MS,
  COMM_VERDICT_SCHEMA,
  type CommVerdict,
  applyFloor,
  capForBacklog,
  parseCommVerdict,
} from './verdict';

const NOW = new Date('2026-09-09T12:00:00.000Z');

/** A message that arrived `hoursAgo` before the fixed clock. */
const at = (hoursAgo: number): Date => new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);

function verdict(overrides: Partial<CommVerdict> = {}): CommVerdict {
  return {
    tier: 'today',
    owes_reply: true,
    ask: 'Approve the Q3 invoice before the 5pm billing run.',
    reason: 'A named deadline today, from a colleague who is blocked on it.',
    ...overrides,
  };
}

describe('COMM_VERDICT_SCHEMA', () => {
  it('requires all four fields and closes the object', () => {
    expect(COMM_VERDICT_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['tier', 'owes_reply', 'ask', 'reason'],
    });
  });

  it('offers the four tiers as an enum, so a fifth is not something the model can emit', () => {
    const properties = COMM_VERDICT_SCHEMA['properties'] as Record<string, unknown>;
    expect(properties['tier']).toEqual({ enum: ['asap', 'today', 'whenever', 'fyi'] });
  });
});

describe('parseCommVerdict', () => {
  it('reads a well-formed verdict', () => {
    expect(parseCommVerdict({ ...verdict() })).toEqual(verdict());
  });

  it('rejects a tier outside the enum rather than repairing it', () => {
    // The schema already closes the value space, so a tier that isn't one of the four means the
    // structured output failed — and a guessed replacement would be alfred inventing a judgment.
    expect(parseCommVerdict({ ...verdict(), tier: 'urgent' })).toBeUndefined();
  });

  it.each([
    ['a bare JSON null', JSON.parse('null')],
    ['an array', [verdict()]],
    ['a string', '{"tier":"today"}'],
  ])('rejects %s', (_name, raw: unknown) => {
    expect(parseCommVerdict(raw)).toBeUndefined();
  });

  it.each(['tier', 'owes_reply', 'ask', 'reason'])('rejects a body missing %s', (key) => {
    const body = Object.fromEntries(Object.entries(verdict()).filter(([field]) => field !== key));

    expect(parseCommVerdict(body)).toBeUndefined();
  });

  it('rejects owes_reply when it is not a boolean', () => {
    expect(parseCommVerdict({ ...verdict(), owes_reply: 'yes' })).toBeUndefined();
  });

  it('keeps only the four fields, so nothing extra rides into the database', () => {
    const parsed = parseCommVerdict({ ...verdict(), confidence: 0.9 });

    expect(parsed).toEqual(verdict());
  });
});

describe('applyFloor', () => {
  it('lifts an owed reply off the shelf and onto whenever', () => {
    // The floor rule: one blended number, but an obligation is never invisible. Without it the
    // non-urgent-but-owed message lands unbadged, which is the failure the module exists to fix.
    expect(applyFloor(verdict({ tier: 'fyi', owes_reply: true })).tier).toBe('whenever');
  });

  it('leaves a shelved message alone when nothing is owed', () => {
    expect(applyFloor(verdict({ tier: 'fyi', owes_reply: false })).tier).toBe('fyi');
  });

  it.each(['asap', 'today', 'whenever'] as const)('never moves an owed %s', (tier) => {
    expect(applyFloor(verdict({ tier, owes_reply: true })).tier).toBe(tier);
  });

  it('changes nothing else about the verdict', () => {
    const raised = applyFloor(verdict({ tier: 'fyi', owes_reply: true }));

    expect(raised).toEqual(verdict({ tier: 'whenever', owes_reply: true }));
  });
});

describe('capForBacklog', () => {
  it('caps a seven-hour-old asap to today', () => {
    // A backlog — a first sweep after a source is enabled, or the classifier catching up after an
    // outage — is judged on the message's age, not on a flag: any lag makes the same backlog.
    expect(capForBacklog('asap', { receivedAt: at(7), now: NOW })).toBe('today');
  });

  it('leaves a one-hour-old asap alone', () => {
    expect(capForBacklog('asap', { receivedAt: at(1), now: NOW })).toBe('asap');
  });

  it('caps exactly at the age bound', () => {
    const boundary = new Date(NOW.getTime() - BACKLOG_MAX_AGE_MS);

    expect(capForBacklog('asap', { receivedAt: boundary, now: NOW })).toBe('today');
  });

  it.each(['today', 'whenever', 'fyi'] as const)('never touches a stale %s', (tier) => {
    // Only ASAP claims "break focus for this", so only ASAP is worth suppressing on age.
    expect(capForBacklog(tier, { receivedAt: at(72), now: NOW })).toBe(tier);
  });

  it('honours an explicit age bound', () => {
    expect(capForBacklog('asap', { receivedAt: at(2), now: NOW, maxAgeMs: 60 * 60 * 1000 })).toBe(
      'today',
    );
  });

  it('caps an age it cannot compute, rather than claiming now', () => {
    expect(capForBacklog('asap', { receivedAt: new Date('nonsense'), now: NOW })).toBe('today');
  });

  it('leaves a message stamped in the future alone', () => {
    // A skewed sending clock is not a backlog.
    expect(capForBacklog('asap', { receivedAt: at(-3), now: NOW })).toBe('asap');
  });
});
