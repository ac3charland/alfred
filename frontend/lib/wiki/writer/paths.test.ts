import { folderName, slugify, todayUtc, uniqueFolderName } from './paths';

describe('slugify', () => {
  it.each([
    ['Why habits stick', 'why-habits-stick'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
    ["Don't stop: the 3 rules of habit-stacking!", 'don-t-stop-the-3-rules-of-habit-stacking'],
    ['Café — crème brûlée & naïve façades', 'cafe-creme-brulee-naive-facades'],
    ['UPPER Case And CamelCase', 'upper-case-and-camelcase'],
    ['multiple   spaces\tand\nnewlines', 'multiple-spaces-and-newlines'],
    ['snake_case_stays_separated', 'snake-case-stays-separated'],
    ['Ünïcödé ligatures ﬁne ½', 'unicode-ligatures-fine-1-2'],
    ['', 'untitled'],
    ['!!!', 'untitled'],
    ['日本語のタイトル', 'untitled'],
    ['42', '42'],
  ])('slugs %j as %j', (title, expected) => {
    expect(slugify(title)).toBe(expected);
  });

  it('cuts a long title at a word boundary, never mid-word, to at most 60 characters', () => {
    const title =
      'The surprisingly complicated history of the humble paperclip and the people who bent it';
    const slug = slugify(title);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toBe('the-surprisingly-complicated-history-of-the-humble-paperclip');
    expect(slug.endsWith('-')).toBe(false);
  });

  it('keeps a title that lands exactly on the limit whole', () => {
    const exact = 'a'.repeat(29) + '-' + 'b'.repeat(30);
    expect(exact).toHaveLength(60);
    expect(slugify(exact)).toBe(exact);
  });

  it('keeps every full word when the character after the limit is the separator', () => {
    // 60 characters of words, then a dash, then more: the cut lands on the dash and keeps all
    // 60 characters rather than dropping the last whole word.
    const title = 'aaaa '.repeat(12).trim() + ' bbbb';
    expect(slugify(title)).toBe('aaaa-'.repeat(12).slice(0, -1));
  });

  it('cuts hard when the first word alone exceeds the limit', () => {
    expect(slugify('x'.repeat(70))).toBe('x'.repeat(60));
  });
});

// The wiki's own table (scripts/lib/paths.test.ts), verbatim: a folder Alfred names is one the
// wiki's `npm run add` would have named.
describe("the wiki's slug and folder-name table", () => {
  it('lower-cases, folds accents, and joins words with -', () => {
    expect(slugify('Crème Brûlée: A Story!')).toBe('creme-brulee-a-story');
  });

  it('cuts at a word boundary within the limit', () => {
    expect(slugify('if we ever fully understood how the human brain knew', 40)).toBe(
      'if-we-ever-fully-understood-how-the',
    );
  });

  it('defaults to 60 characters', () => {
    const slug = slugify('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('a single over-long word is cut mid-word', () => {
    expect(slugify('a'.repeat(70))).toBe('a'.repeat(60));
  });

  it('nothing usable becomes untitled', () => {
    expect(slugify('!!!')).toBe('untitled');
  });

  it('folderName is <captured>-<slug>', () => {
    expect(folderName('2026-10-01', 'Brain Rules')).toBe('2026-10-01-brain-rules');
  });

  it('uniqueFolderName adds -2, -3', () => {
    const taken = new Set(['x', 'x-2']);
    expect(uniqueFolderName('x', taken)).toBe('x-3');
    expect(uniqueFolderName('y', taken)).toBe('y');
  });

  it('todayUtc', () => {
    expect(todayUtc(new Date('2026-10-01T23:59:00Z'))).toBe('2026-10-01');
  });
});

describe('folderName', () => {
  it('is the captured date, a dash, the slug', () => {
    expect(folderName('2026-10-03', 'Why habits stick')).toBe('2026-10-03-why-habits-stick');
  });
});

describe('uniqueFolderName', () => {
  it('returns the name itself when nothing has taken it', () => {
    expect(uniqueFolderName('2026-10-03-a', new Set())).toBe('2026-10-03-a');
  });

  it('appends -2, -3, … past every taken name', () => {
    const taken = new Set(['2026-10-03-a', '2026-10-03-a-2']);
    expect(uniqueFolderName('2026-10-03-a', taken)).toBe('2026-10-03-a-3');
  });
});

describe('todayUtc', () => {
  it('is the UTC calendar date, not the local one', () => {
    expect(todayUtc(new Date('2026-10-03T23:30:00-05:00'))).toBe('2026-10-04');
    expect(todayUtc(new Date('2026-10-03T12:00:00Z'))).toBe('2026-10-03');
  });
});
