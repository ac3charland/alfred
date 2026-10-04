import { textToHtml } from './content';

jest.mock('server-only', () => ({}));

describe('textToHtml', () => {
  it('wraps each non-empty line in a paragraph', () => {
    // `htmlToText` leaves the stored body one line per block, so the line IS the paragraph —
    // that is the only structure left to recover.
    expect(textToHtml('First block\n\nSecond block\n')).toBe(
      '<p>First block</p>\n<p>Second block</p>',
    );
  });

  it('escapes the characters that would otherwise read as markup', () => {
    // The text came out of mail nobody here wrote and is about to be parsed as a document, so a
    // stray `<script>` in a post's prose must arrive as prose.
    expect(textToHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;</p>',
    );
  });

  it('escapes the ampersand before the characters whose escapes contain one', () => {
    // A naive sequence of replacements double-escapes: `<` → `&lt;` → `&amp;lt;`. One pass over
    // the character class is what keeps it single.
    expect(textToHtml('a & b < c')).toBe('<p>a &amp; b &lt; c</p>');
  });

  it('trims each line, so soft-wrapped mail does not arrive indented', () => {
    expect(textToHtml('  padded line  ')).toBe('<p>padded line</p>');
  });

  it('returns an empty string for a blank or whitespace-only body', () => {
    // So the caller has one "nothing to send" case however the column got that way.
    expect(textToHtml('')).toBe('');
    expect(textToHtml('   \n\n \t ')).toBe('');
  });
});
