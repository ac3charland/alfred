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

  it('strips punctuation from a phone number, keeping its leading plus', () => {
    expect(normalizeHandle('+1 (555) 010-2233')).toBe('+15550102233');
    expect(normalizeHandle('555-010-2233')).toBe('5550102233');
  });

  it('keeps a country code meaningful — a bare number is a different handle', () => {
    expect(normalizeHandle('+15550102233')).not.toBe(normalizeHandle('5550102233'));
  });

  it('normalises an empty or punctuation-only handle to the empty string', () => {
    expect(normalizeHandle(' '.repeat(3))).toBe('');
    expect(normalizeHandle('()-')).toBe('');
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

  it('returns undefined for a handle nobody on the roster claims', () => {
    expect(resolvePerson('stranger@example.org', people)).toBeUndefined();
  });

  it('never resolves an empty handle onto a person with an empty stored handle', () => {
    expect(resolvePerson(' '.repeat(3), [person('Blank', [''])])).toBeUndefined();
  });
});
