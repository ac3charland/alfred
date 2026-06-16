import { parseFrontmatter } from './frontmatter';

const block = (inner: string): string =>
  ['Some PR description.', '', '```alfred', inner, '```', '', 'Trailing prose.'].join('\n');

describe('parseFrontmatter', () => {
  it('parses a single-ticket refinement block', () => {
    const result = parseFrontmatter(
      block(
        ['alfred-ticket: ALF-42', 'phase: refinement', 'spec-path: docs/specs/ALF-42.md'].join(
          '\n',
        ),
      ),
    );
    expect(result).toEqual({
      tickets: ['ALF-42'],
      phase: 'refinement',
      specPath: 'docs/specs/ALF-42.md',
    });
  });

  it('parses a comma-separated ticket list and trims each ref', () => {
    const result = parseFrontmatter(
      block(['alfred-ticket: ALF-42 ,  ALF-43,RLP-7', 'phase: implementation'].join('\n')),
    );
    expect(result?.tickets).toEqual(['ALF-42', 'ALF-43', 'RLP-7']);
  });

  it('leaves spec-path undefined on an implementation block', () => {
    const result = parseFrontmatter(
      block(['alfred-ticket: ALF-42', 'phase: implementation'].join('\n')),
    );
    expect(result).toEqual({ tickets: ['ALF-42'], phase: 'implementation', specPath: undefined });
  });

  it('returns undefined when there is no alfred block (PR is not ours)', () => {
    expect(parseFrontmatter('Just a normal PR description.')).toBeUndefined();
    expect(parseFrontmatter()).toBeUndefined();
  });

  it('returns undefined when the block is missing alfred-ticket', () => {
    expect(
      parseFrontmatter(block(['phase: refinement', 'spec-path: x.md'].join('\n'))),
    ).toBeUndefined();
  });

  it('returns undefined when the block is missing phase', () => {
    expect(parseFrontmatter(block('alfred-ticket: ALF-42'))).toBeUndefined();
  });

  it('returns undefined when phase is not a known value', () => {
    expect(
      parseFrontmatter(block(['alfred-ticket: ALF-42', 'phase: bogus'].join('\n'))),
    ).toBeUndefined();
  });

  it('returns undefined when alfred-ticket is present but empty', () => {
    expect(
      parseFrontmatter(block(['alfred-ticket:   ', 'phase: refinement'].join('\n'))),
    ).toBeUndefined();
  });
});
