import { isBug, isSpike, storyKindOf } from './story-kind';

describe('storyKindOf', () => {
  it('reads the canonical prefixes', () => {
    expect(storyKindOf({ title: 'Spike: outbound notifications via Telegram' })).toBe('spike');
    expect(storyKindOf({ title: 'Bug: the capture box keeps its draft after submit' })).toBe('bug');
  });

  it('falls back to an ordinary story when no prefix leads the title', () => {
    expect(storyKindOf({ title: 'Verify the GitHub webhook HMAC signature' })).toBe('story');
  });

  it('never throws on a null title (the view row type is all-nullable)', () => {
    expect(storyKindOf({ title: null })).toBe('story');
  });
});

describe.each([
  { name: 'isSpike', predicate: isSpike, prefix: 'Spike', word: 'spike', other: 'Bug: a defect' },
  { name: 'isBug', predicate: isBug, prefix: 'Bug', word: 'bug', other: 'Spike: a question' },
])('$name', ({ predicate, prefix, word, other }) => {
  it('matches the canonical prefix', () => {
    expect(predicate({ title: `${prefix}: something worth doing` })).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(predicate({ title: `${word}: which queue?` })).toBe(true);
    expect(predicate({ title: `${word.toUpperCase()}: which queue?` })).toBe(true);
  });

  it('ignores leading whitespace', () => {
    expect(predicate({ title: `  ${prefix}: trailing thought` })).toBe(true);
  });

  it('does not require a space after the colon', () => {
    expect(predicate({ title: `${prefix}:no space after the colon` })).toBe(true);
  });

  it('is not matched by the bare word with no colon', () => {
    expect(predicate({ title: `${prefix} out the retry policy` })).toBe(false);
  });

  it('requires the prefix to lead the title', () => {
    expect(predicate({ title: `Fix the CPU ${word}: on dashboards` })).toBe(false);
  });

  it('is false for the other kind, a null title and an empty title', () => {
    expect(predicate({ title: other })).toBe(false);
    expect(predicate({ title: null })).toBe(false);
    expect(predicate({ title: '' })).toBe(false);
  });
});
