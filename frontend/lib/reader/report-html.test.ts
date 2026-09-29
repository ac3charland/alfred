/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { renderReportHtml } from './report-html';

jest.mock('server-only', () => ({}));

// The unified packages are pure ESM, which Jest's default transform leaves alone, so importing them
// here would fail on the first `export`. Mocking them out would leave nothing to prove — that raw
// HTML is dropped is the pipeline's own behaviour — so each is loaded by Node's own loader instead:
// `process.getBuiltinModule('node:module')` is the real module, where `import 'node:module'`
// hands back Jest's wrapper, which loads through Jest and fails the same way. Node 24 `require`s
// an ESM graph like this one synchronously.
function mockNativeModule(id: string): unknown {
  return process.getBuiltinModule('node:module').createRequire(__filename)(id);
}
jest.mock('unified', () => mockNativeModule('unified'));
jest.mock('remark-parse', () => mockNativeModule('remark-parse'));
jest.mock('remark-gfm', () => mockNativeModule('remark-gfm'));
jest.mock('remark-rehype', () => mockNativeModule('remark-rehype'));
jest.mock('rehype-stringify', () => mockNativeModule('rehype-stringify'));

describe('renderReportHtml', () => {
  it('renders headings, paragraphs and emphasis', () => {
    const html = renderReportHtml(
      [
        '# Is a heat pump worth it?',
        '',
        '*Researched 2026-09-29 · 9 sources*',
        '',
        '## Bottom line',
        '',
        'Probably **yes**.',
      ].join('\n'),
    );

    expect(html).toContain('<h1>Is a heat pump worth it?</h1>');
    expect(html).toContain('<em>Researched 2026-09-29 · 9 sources</em>');
    expect(html).toContain('<h2>Bottom line</h2>');
    expect(html).toContain('<p>Probably <strong>yes</strong>.</p>');
  });

  it('renders a GFM table', () => {
    const html = renderReportHtml(
      ['| Unit | Cost |', '| --- | --- |', '| Cold-climate | $14,000 |'].join('\n'),
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Unit</th>');
    expect(html).toContain('<td>$14,000</td>');
  });

  it('renders links, inline and as bare autolinks', () => {
    const html = renderReportHtml(
      'See [the rebate schedule](https://example.com/rebates) or https://example.org/study.',
    );

    expect(html).toContain('<a href="https://example.com/rebates">the rebate schedule</a>');
    expect(html).toContain('<a href="https://example.org/study">https://example.org/study</a>');
  });

  it('renders lists and inline code', () => {
    const html = renderReportHtml('- one\n- two with `code`\n\n1. first\n2. second');

    expect(html).toContain('<ul>');
    expect(html).toContain('<li>two with <code>code</code></li>');
    expect(html).toContain('<ol>');
  });

  it('renders the Sources section as written', () => {
    const html = renderReportHtml(
      '## Sources\n\n[1] Title — Publisher, 2025. https://example.com/a',
    );

    expect(html).toContain('<h2>Sources</h2>');
    expect(html).toContain('[1] Title — Publisher, 2025.');
  });

  it('returns an empty string for an empty report', () => {
    expect(renderReportHtml('')).toBe('');
  });

  describe('raw HTML in the markdown never reaches the output', () => {
    it.each([
      ['a script block', '<script>alert(1)</script>\n\nAfter.', ['<script', 'alert(1)']],
      ['an inline script', 'Before <script>steal()</script> after.', ['<script', '</script']],
      ['an image with an event handler', 'Look: <img src=x onerror=alert(1)>', ['<img', 'onerror']],
      [
        'an iframe',
        '<iframe src="https://evil.example/"></iframe>\n\nAfter.',
        ['<iframe', 'evil.example'],
      ],
      ['an HTML comment', 'Before <!-- hidden instruction --> after.', ['<!--', 'hidden']],
      [
        'a styled element',
        '<div style="position:fixed">overlay</div>\n\nAfter.',
        ['<div', 'style=', 'position:fixed'],
      ],
      ['an anchor tag', '<a href="https://evil.example/">click</a>', ['<a ', 'evil.example']],
    ])('drops %s', (_label, markdown, forbidden) => {
      const html = renderReportHtml(markdown);

      for (const fragment of forbidden) expect(html).not.toContain(fragment);
    });

    it('keeps the prose around the dropped markup', () => {
      const html = renderReportHtml('Before <script>alert(1)</script> after.');

      expect(html).toContain('Before');
      expect(html).toContain('after.');
    });

    it('keeps markup inside a code span or fence as visible text, escaped', () => {
      const html = renderReportHtml(
        'Use `<script>` carefully.\n\n```html\n<img src=x onerror=1>\n```',
      );

      expect(html).toContain('<code>&#x3C;script></code>');
      expect(html).toContain('&#x3C;img src=x onerror=1>');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
    });
  });

  describe('images', () => {
    it.each([
      ['a remote image', '![A chart of running cost](https://tracker.example/pixel.png?u=1)'],
      ['a javascript: image', '![A chart of running cost](javascript:alert(1))'],
      ['a data: image', '![A chart of running cost](data:image/png;base64,AAAA)'],
    ])('drops %s, keeping its alt text as plain text', (_label, markdown) => {
      // An image in the report would load from wherever the session was told to point it the
      // moment the owner opens the report — a tracking pixel an injected page can plant.
      const html = renderReportHtml(markdown);

      expect(html).not.toContain('<img');
      expect(html).not.toMatch(/tracker\.example|javascript:|data:/);
      expect(html).toContain('A chart of running cost');
    });
  });

  describe('link targets', () => {
    it.each([
      ['a javascript: link', '[click](javascript:alert(1))'],
      ['a mixed-case javascript: link', '[click](JaVaScRiPt:alert(1))'],
      ['a data: link', '[click](data:text/html,<b>x</b>)'],
      ['a vbscript: link', '[click](vbscript:msgbox(1))'],
    ])('drops the target of %s and keeps its text', (_label, markdown) => {
      const html = renderReportHtml(markdown);

      expect(html.toLowerCase()).not.toMatch(/javascript:|data:|vbscript:/);
      expect(html).toMatch(/click|pic/);
    });

    it.each([
      ['https', '[a](https://example.org/a)', 'href="https://example.org/a"'],
      // A host with no public TLD: unicorn/prefer-https rewrites any other http:// literal.
      ['http', '[a](http://localhost:8080/a)', 'href="http://localhost:8080/a"'],
      ['mailto', '[a](mailto:owner@example.org)', 'href="mailto:owner@example.org"'],
      ['a fragment', '[a](#sources)', 'href="#sources"'],
    ])('keeps %s targets', (_label, markdown, attribute) => {
      expect(renderReportHtml(markdown)).toContain(attribute);
    });
  });
});
