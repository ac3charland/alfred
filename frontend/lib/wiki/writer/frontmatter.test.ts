import { type CoreFrontmatter, renderWikiFile, serializeFrontmatter } from './frontmatter';

const CORE: CoreFrontmatter = {
  source_type: 'idea',
  origin: 'mine',
  title: 'Spaced repetition: why "forgetting" is the signal',
  author: null,
  source_url: null,
  published: null,
  captured: '2026-10-03',
  via: 'alfred-inbox',
  external_id: 'alfred:item:11111111-1111-4111-8111-111111111111',
};

describe('serializeFrontmatter', () => {
  it("writes the wiki's keys in its order, strings JSON-quoted and nulls bare", () => {
    expect(serializeFrontmatter(CORE)).toBe(
      [
        '---',
        'source_type: "idea"',
        'origin: "mine"',
        String.raw`title: "Spaced repetition: why \"forgetting\" is the signal"`,
        'author: null',
        'source_url: null',
        'published: null',
        'captured: "2026-10-03"',
        'via: "alfred-inbox"',
        'external_id: "alfred:item:11111111-1111-4111-8111-111111111111"',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('writes fidelity last, and only when the file carries author text', () => {
    const withFidelity = serializeFrontmatter({ ...CORE, fidelity: 'pointer' });
    expect(
      withFidelity.endsWith(
        'external_id: "alfred:item:11111111-1111-4111-8111-111111111111"\nfidelity: "pointer"\n---\n',
      ),
    ).toBe(true);
    expect(serializeFrontmatter(CORE)).not.toContain('fidelity');
  });

  it('never needs a YAML library: a newline or a hash inside a title stays one quoted scalar', () => {
    const line = serializeFrontmatter({ ...CORE, title: 'Line one\nline #two' })
      .split('\n')
      .find((candidate) => candidate.startsWith('title:'));
    expect(line).toBe(String.raw`title: "Line one\nline #two"`);
  });

  it('escapes DEL and the C1 controls JSON.stringify leaves raw, so the scalar is valid YAML too', () => {
    const line = serializeFrontmatter({ ...CORE, title: 'DEL\u007F and C1\u0080here' })
      .split('\n')
      .find((candidate) => candidate.startsWith('title:'));
    expect(line).toBe(String.raw`title: "DEL\u007f and C1\u0080here"`);
  });

  it('leaves U+0085 (NEL) bare — the one C1 code point YAML allows unescaped', () => {
    const line = serializeFrontmatter({ ...CORE, title: 'NEL\u0085here' })
      .split('\n')
      .find((candidate) => candidate.startsWith('title:'));
    expect(line).toBe('title: "NEL\u0085here"');
  });
});

describe('renderWikiFile', () => {
  it('separates the body from the frontmatter with one blank line and ends in one newline', () => {
    expect(renderWikiFile(CORE, 'Body text\n\n\n')).toBe(
      `${serializeFrontmatter(CORE)}\nBody text\n`,
    );
  });

  it('ends an empty body at the closing fence — the pointer shape filing reads as no body', () => {
    expect(renderWikiFile(CORE, '')).toBe(serializeFrontmatter(CORE));
  });
});
