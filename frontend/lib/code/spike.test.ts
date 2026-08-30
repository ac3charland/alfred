import { isSpike } from './spike';

describe('isSpike', () => {
  it('matches the canonical "Spike: " prefix', () => {
    expect(isSpike({ title: 'Spike: outbound notifications via Telegram' })).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isSpike({ title: 'spike: which queue?' })).toBe(true);
    expect(isSpike({ title: 'SPIKE: which queue?' })).toBe(true);
  });

  it('ignores leading whitespace', () => {
    expect(isSpike({ title: '  Spike: trailing thought' })).toBe(true);
  });

  it('does not require a space after the colon', () => {
    expect(isSpike({ title: 'Spike:no space after the colon' })).toBe(true);
  });

  it('is not matched by the bare word "spike" with no colon', () => {
    expect(isSpike({ title: 'Spike out the retry policy' })).toBe(false);
  });

  it('requires the prefix to lead the title', () => {
    expect(isSpike({ title: 'Fix the CPU spike: on dashboards' })).toBe(false);
  });

  it('never throws on a null title (the view row type is all-nullable)', () => {
    expect(isSpike({ title: null })).toBe(false);
  });

  it('is false for an empty title', () => {
    expect(isSpike({ title: '' })).toBe(false);
  });
});
