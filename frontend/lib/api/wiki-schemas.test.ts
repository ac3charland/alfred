import { sendReaderPicksSchema } from './wiki-schemas';

const SIX = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

describe('sendReaderPicksSchema', () => {
  it('keeps each bullet exactly as sent, since the route matches it against the overview', () => {
    const parsed = sendReaderPicksSchema.safeParse({
      ideas: ['  An idea with spaces '],
      evidence: [' Evidence with spaces  '],
    });

    expect(parsed.data?.ideas).toEqual(['  An idea with spaces ']);
    expect(parsed.data?.evidence).toEqual([' Evidence with spaces  ']);
  });

  it.each([
    ['ideas alone — the body an older tab still posts', { ideas: ['An idea'] }],
    ['evidence alone', { evidence: ['A study'] }],
    ['both lists', { ideas: ['An idea'], evidence: ['A study'] }],
    ['one list empty beside a full one', { ideas: [], evidence: ['A study'] }],
    ['six bullets in each list', { ideas: SIX, evidence: SIX }],
  ])('accepts %s', (_label, body) => {
    expect(sendReaderPicksSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['both lists missing', {}],
    ['both lists empty', { ideas: [], evidence: [] }],
    ['seven ideas', { ideas: [...SIX, 'Seven'] }],
    ['seven pieces of evidence', { evidence: [...SIX, 'Seven'] }],
    ['a stray key', { ideas: ['An idea'], note: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(sendReaderPicksSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['an empty', ''],
    ['a whitespace-only', ' '.repeat(3)],
    ['a lone-newline', '\n'],
  ])('rejects %s bullet in either list — no bullet is one', (_label, bullet) => {
    expect(sendReaderPicksSchema.safeParse({ ideas: ['A real idea', bullet] }).success).toBe(false);
    expect(sendReaderPicksSchema.safeParse({ evidence: ['A real study', bullet] }).success).toBe(
      false,
    );
  });
});
