import { textToHtml } from './content';

jest.mock('server-only', () => ({}));

describe('textToHtml', () => {
  it('wraps each line in its own paragraph', () => {
    expect(textToHtml('First paragraph.\nSecond paragraph.')).toBe(
      '<p>First paragraph.</p>\n<p>Second paragraph.</p>',
    );
  });

  it('wraps a single line in a single paragraph', () => {
    expect(textToHtml('Just one line.')).toBe('<p>Just one line.</p>');
  });

  it('escapes the five characters that could open markup or close an attribute', () => {
    expect(textToHtml(`Tom & Jerry <script>alert("x")</script> it's`)).toBe(
      '<p>Tom &amp; Jerry &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; it&#39;s</p>',
    );
  });

  it('escapes ampersands first, so an entity-looking input is not double-decoded', () => {
    expect(textToHtml('&lt;b&gt;')).toBe('<p>&amp;lt;b&amp;gt;</p>');
  });

  it('drops blank and whitespace-only lines, since each stored line is already one block', () => {
    expect(textToHtml('One\n\n   \n\t\nTwo\n')).toBe('<p>One</p>\n<p>Two</p>');
  });

  it('handles Windows line endings without leaving a stray carriage return', () => {
    expect(textToHtml('One\r\nTwo')).toBe('<p>One</p>\n<p>Two</p>');
  });

  it('trims the padding around a line', () => {
    expect(textToHtml('   indented line  ')).toBe('<p>indented line</p>');
  });

  it('yields the empty string when there is no text at all', () => {
    expect(textToHtml('')).toBe('');
    expect(textToHtml(' \n \n')).toBe('');
  });
});
