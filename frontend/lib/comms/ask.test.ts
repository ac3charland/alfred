import { makeCommMessage } from '@/lib/comms/fixtures';

import { askLine } from './ask';

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

describe('askLine', () => {
  it('leads with the ask', () => {
    const message = makeCommMessage(ACCOUNT, {
      ask: 'Needs the Q3 invoice approved before the 5pm billing run.',
      subject: 'Q3 invoice',
    });
    expect(askLine(message)).toBe('Needs the Q3 invoice approved before the 5pm billing run.');
  });

  it('falls back to the subject when the row was never judged', () => {
    const message = makeCommMessage(ACCOUNT, { ask: null, subject: 'Q3 invoice' });
    expect(askLine(message)).toBe('Q3 invoice');
  });

  it('falls back to a collapsed head of the body', () => {
    const message = makeCommMessage(ACCOUNT, {
      ask: null,
      subject: null,
      body: '  Hi there\n\n  are you free Thursday?  ',
    });
    expect(askLine(message)).toBe('Hi there are you free Thursday?');
  });

  it('truncates a long body rather than spilling the row', () => {
    const message = makeCommMessage(ACCOUNT, { ask: null, subject: null, body: 'x'.repeat(400) });
    expect(askLine(message)).toBe(`${'x'.repeat(120)}…`);
  });

  it('says so when there is no readable text at all', () => {
    const message = makeCommMessage(ACCOUNT, { ask: null, subject: null, body: ' '.repeat(3) });
    expect(askLine(message)).toBe('No readable text — open it at the source.');
  });
});
