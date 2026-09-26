/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { textToHtml } from './content';

jest.mock('server-only', () => ({}));

describe('textToHtml', () => {
  it('wraps each non-empty line in a paragraph — the stored text keeps one line per block', () => {
    expect(textToHtml('First paragraph.\n\nSecond one.\n   \nThird.')).toBe(
      '<p>First paragraph.</p>\n<p>Second one.</p>\n<p>Third.</p>',
    );
  });

  it('escapes the text, so a post about HTML is not read as HTML', () => {
    expect(textToHtml(`Use <b> & "quotes" — it's fine`)).toBe(
      '<p>Use &lt;b&gt; &amp; &quot;quotes&quot; — it&#39;s fine</p>',
    );
  });

  it('is empty for text with no lines worth keeping', () => {
    expect(textToHtml('')).toBe('');
    expect(textToHtml('\n  \n')).toBe('');
  });
});
