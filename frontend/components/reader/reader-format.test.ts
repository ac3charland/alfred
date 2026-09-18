import { formatPostDate, formatReadMinutes, readMinutes } from './reader-format';

describe('formatPostDate', () => {
  it('renders a bare month/day for this calendar year', () => {
    const now = new Date(2026, 8, 18);
    expect(formatPostDate('2026-09-16T14:00:00.000Z', now)).toBe('Sep 16');
  });

  it('appends the year once the post is from an earlier one', () => {
    const now = new Date(2026, 8, 18);
    expect(formatPostDate('2025-09-16T14:00:00.000Z', now)).toBe('Sep 16, 2025');
  });
});

describe('readMinutes', () => {
  it('rounds up to the next whole minute at 230 words per minute', () => {
    expect(readMinutes(3220)).toBe(Math.ceil(3220 / 230));
  });

  it('floors at one minute for a very short post', () => {
    expect(readMinutes(10)).toBe(1);
  });

  it('floors at one minute for a zero word count', () => {
    expect(readMinutes(0)).toBe(1);
  });
});

describe('formatReadMinutes', () => {
  it('reads "N min read"', () => {
    expect(formatReadMinutes(3220)).toBe('14 min read');
  });

  it('reads "1 min read" for a very short post', () => {
    expect(formatReadMinutes(50)).toBe('1 min read');
  });
});
