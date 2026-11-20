import { lintPrBody } from './lint.ts';

const URL = 'https://github.com/ac3charland/alfred/blob/main/docs/demos/x.md';
const BT = '``';

describe('lintPrBody', () => {
  it('passes a body with plain, linked and single-backticked URLs', () => {
    const body = [
      `See ${URL}.`,
      `📝 **Demo:** [docs/demos/x.md](${URL})`,
      'Paste a feed URL such as `https://mlarson.org/feed.xml` into the field.',
    ].join('\n');
    expect(lintPrBody(body)).toEqual([]);
  });

  it('flags a markdown link whose URL is wrapped in double backticks', () => {
    const body = `## What\n\n📝 **Demo:** [x.md](${BT}${URL}${BT})\n`;
    expect(lintPrBody(body)).toEqual([{ line: 3, url: URL }]);
  });

  it('flags a bare URL wrapped in double backticks', () => {
    expect(lintPrBody(`Findings: ${BT}${URL}${BT}`)).toEqual([{ line: 1, url: URL }]);
  });

  it('reports the URL without the link syntax that follows it', () => {
    // As seen in a real PR: the closing backticks landed after the link's `)`.
    expect(lintPrBody(`**[x.md](${BT}${URL})**${BT}`)).toEqual([{ line: 1, url: URL }]);
  });

  it('flags the CommonMark padded form with a space inside the backticks', () => {
    expect(lintPrBody(`${BT} ${URL} ${BT}`)).toEqual([{ line: 1, url: URL }]);
  });

  it('flags http as well as https', () => {
    expect(lintPrBody(`${BT}https://example.com${BT}`)).toEqual([
      { line: 1, url: 'https://example.com' },
    ]);
  });

  it('reports every occurrence with its line', () => {
    const body = `${BT}https://a.example${BT} and ${BT}https://b.example${BT}\nok\n[c](${BT}https://c.example${BT})`;
    expect(lintPrBody(body)).toEqual([
      { line: 1, url: 'https://a.example' },
      { line: 1, url: 'https://b.example' },
      { line: 3, url: 'https://c.example' },
    ]);
  });

  it('ignores URLs inside fenced code blocks', () => {
    const body = [
      '```alfred',
      'alfred-ticket: ALF-1',
      '```',
      '```md',
      `[x](${BT}${URL}${BT})`,
      '```',
      '~~~',
      `${BT}${URL}${BT}`,
      '~~~',
      `after ${BT}${URL}${BT}`,
    ].join('\n');
    expect(lintPrBody(body)).toEqual([{ line: 10, url: URL }]);
  });

  it('handles CRLF line endings', () => {
    expect(lintPrBody(`ok\r\n${BT}${URL}${BT}\r\n`)).toEqual([{ line: 2, url: URL }]);
  });

  it('passes an empty body', () => {
    expect(lintPrBody('')).toEqual([]);
  });
});
