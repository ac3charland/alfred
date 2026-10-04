import { textToHtml } from './content';

jest.mock('server-only', () => ({}));

describe('textToHtml', () => {
  it('wraps each non-empty line in a paragraph', () => {
    expect(textToHtml('First block.\n\nSecond block.\r\nThird.')).toBe(
      '<p>First block.</p>\n<p>Second block.</p>\n<p>Third.</p>',
    );
  });

  it('escapes the text, so a stored body can never inject markup', () => {
    expect(textToHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>',
    );
  });

  it('is empty for a body with nothing in it', () => {
    expect(textToHtml('  \n\n ')).toBe('');
  });
});
