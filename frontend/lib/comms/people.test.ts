import type { CommPersonWithHandles } from '@/lib/types';

import { makeCommHandle, makeCommPerson, resetCommFixtureClock } from './fixtures';
import { normalizeHandle, resolvePerson } from './people';

beforeEach(() => {
  resetCommFixtureClock();
});

/** A roster person carrying the handles that resolve to them. */
function person(name: string, handles: string[]): CommPersonWithHandles {
  const row = makeCommPerson(name);
  return { ...row, comm_handles: handles.map((handle) => makeCommHandle(row.id, handle)) };
}

describe('normalizeHandle', () => {
  it('lower-cases and trims an email address', () => {
    expect(normalizeHandle('  Dana@Example.COM ')).toBe('dana@example.com');
  });

  it('strips punctuation from a phone number and writes it in E.164', () => {
    expect(normalizeHandle('+1 (555) 010-2233')).toBe('+15550102233');
    expect(normalizeHandle('555-010-2233')).toBe('+15550102233');
    expect(normalizeHandle('15550102233')).toBe('+15550102233');
  });

  // This assertion used to be its own inverse — "a bare number is a different handle" — and that
  // was the defect: the daemon canonicalises every iMessage sender to E.164 before it reaches the
  // database, so a person added by typing their number the way a human writes it never resolved
  // the sender it belonged to, and adding them to the roster appeared to do nothing at all.
  it('treats a bare 10-digit number and its +1 form as one handle', () => {
    expect(normalizeHandle('555-010-2233')).toBe(normalizeHandle('+15550102233'));
  });

  it('does not reshape a number that is neither 10 nor 11-with-a-leading-1 digits', () => {
    expect(normalizeHandle('44 20 7946 0000')).toBe('442079460000');
    expect(normalizeHandle('262966')).toBe('262966');
    // And the inferred country code must not make an international number collide with a local one.
    expect(normalizeHandle('442079460000')).not.toBe(normalizeHandle('2079460000'));
  });

  it('normalises an empty handle to the empty string and leaves digitless text alone', () => {
    expect(normalizeHandle(' '.repeat(3))).toBe('');
    expect(normalizeHandle('()-')).toBe('()-');
  });
});

describe('resolvePerson', () => {
  const dana = person('Dana Whitfield', ['dana@example.com', '+15550102233']);
  const marcus = person('Marcus Okonkwo', ['marcus@example.net']);
  const people = [dana, marcus];

  it('resolves the same human across an email address and a phone number', () => {
    expect(resolvePerson('DANA@example.com', people)?.name).toBe('Dana Whitfield');
    expect(resolvePerson('+1 (555) 010-2233', people)?.name).toBe('Dana Whitfield');
  });

  it('resolves a person stored as a bare number against a sender arriving in E.164', () => {
    const mom = person('Mom', ['5550102299']);
    expect(resolvePerson('+15550102299', [mom])?.name).toBe('Mom');
    expect(resolvePerson('5550102299', [person('Mom', ['+15550102299'])])?.name).toBe('Mom');
  });

  it('returns undefined for a handle nobody on the roster claims', () => {
    expect(resolvePerson('stranger@example.org', people)).toBeUndefined();
  });

  it('never resolves an empty handle onto a person with an empty stored handle', () => {
    expect(resolvePerson(' '.repeat(3), [person('Blank', [''])])).toBeUndefined();
  });
});
