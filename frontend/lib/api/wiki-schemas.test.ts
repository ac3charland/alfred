import { sendReaderIdeasSchema } from './wiki-schemas';

describe('sendReaderIdeasSchema', () => {
  it('keeps each idea exactly as sent, since the route matches it against the bullets', () => {
    const parsed = sendReaderIdeasSchema.safeParse({ ideas: ['  An idea with spaces '] });

    expect(parsed.data?.ideas).toEqual(['  An idea with spaces ']);
  });

  it.each([
    ['an empty idea', ''],
    ['a whitespace-only idea', ' '.repeat(3)],
    ['a lone newline', '\n'],
  ])('rejects %s — no bullet is one', (_label, idea) => {
    expect(sendReaderIdeasSchema.safeParse({ ideas: ['A real idea', idea] }).success).toBe(false);
  });
});
