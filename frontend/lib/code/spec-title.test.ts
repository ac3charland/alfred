import { specTitle } from './spec-title';

const HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>ALF-100 — Story detail on a phone</title></head>
<body><h1>Something else</h1></body>
</html>`;

describe('specTitle', () => {
  it("reads an HTML spec's <title>", () => {
    expect(specTitle(HTML, 'docs/specs/ALF-100.html', 'Spec')).toBe(
      'ALF-100 — Story detail on a phone',
    );
  });

  it('decodes entities and collapses whitespace in an HTML title', () => {
    const html =
      '<html><head><title>\n  Fish &amp; chips\n  on a &lt;plate&gt;\n</title></head></html>';

    expect(specTitle(html, null, 'Spec')).toBe('Fish & chips on a <plate>');
  });

  it("reads a markdown spec's first # line", () => {
    const markdown = '# Inbound filter spec\n\nThe filter classifies each item.\n\n## Goals\n';

    expect(specTitle(markdown, 'docs/specs/ALF-42.md', 'Spec')).toBe('Inbound filter spec');
  });

  it('skips lower-level headings and prose before the first # line', () => {
    const markdown = 'Intro text.\n\n## Not the title\n\n# The real title\n';

    expect(specTitle(markdown, null, 'Spec')).toBe('The real title');
  });

  it('ignores a # comment line inside a fenced code block before the title', () => {
    const backticks = '```bash\n# install\nnpm ci\n```\n\n# The real title\n';
    const tildes = '~~~sh\n# install\n~~~\n\n# The real title\n';

    expect(specTitle(backticks, null, 'Spec')).toBe('The real title');
    expect(specTitle(tildes, null, 'Spec')).toBe('The real title');
  });

  it("falls back to the file's name when the document has no title", () => {
    expect(specTitle('No headings here.', 'docs/specs/ALF-42.md', 'Spec')).toBe('ALF-42.md');
    expect(specTitle('<html><body>x</body></html>', 'docs/specs/ALF-7.html', 'Spec')).toBe(
      'ALF-7.html',
    );
  });

  it('treats an empty title like a missing one', () => {
    expect(specTitle('<html><head><title>  </title></head></html>', 'a/b/c.html', 'Spec')).toBe(
      'c.html',
    );
    expect(specTitle('#   \n', 'a/b/c.md', 'Spec')).toBe('c.md');
  });

  it('falls back to the caller-supplied name when there is no path either', () => {
    expect(specTitle('No headings here.', null, 'Findings')).toBe('Findings');
  });
});
