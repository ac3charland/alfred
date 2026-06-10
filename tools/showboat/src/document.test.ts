import { type ShowboatDocument, parseDocument, serializeDocument } from './document.ts';

describe('serializeDocument', () => {
  it('writes the title, timestamp and entries as showboat-style markdown', () => {
    const document: ShowboatDocument = {
      title: 'Demo',
      timestamp: '2026-06-10T12:00:00.000Z',
      entries: [
        { kind: 'note', text: 'First, run the thing.' },
        { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
        { kind: 'image', alt: 'a shot', path: 'demo-image-1.png' },
      ],
    };

    expect(serializeDocument(document)).toBe(
      [
        '# Demo',
        '',
        '*2026-06-10T12:00:00.000Z*',
        '',
        'First, run the thing.',
        '',
        '```bash',
        'echo hi',
        '```',
        '',
        '```output',
        'hi',
        '```',
        '',
        '![a shot](demo-image-1.png)',
        '',
      ].join('\n'),
    );
  });

  it('renders an empty output block when a command produced no output', () => {
    const document: ShowboatDocument = {
      title: 'Quiet',
      timestamp: 'now',
      entries: [{ kind: 'exec', lang: 'bash', code: 'true', output: '' }],
    };
    expect(serializeDocument(document)).toContain('```output\n```');
  });
});

describe('parseDocument / round-trip', () => {
  it('parses a document back into the same structure it was serialized from', () => {
    const document: ShowboatDocument = {
      title: 'Round trip',
      timestamp: '2026-06-10T12:00:00.000Z',
      entries: [
        { kind: 'note', text: 'narration' },
        { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
        { kind: 'image', alt: 'alt text', path: 'shot.png' },
      ],
    };
    expect(parseDocument(serializeDocument(document))).toEqual(document);
  });

  it('round-trips captured output that itself contains a code fence', () => {
    const nested = '```\nnested fence\n```';
    const document: ShowboatDocument = {
      title: 'Nested',
      timestamp: 'now',
      entries: [{ kind: 'exec', lang: 'bash', code: 'cat file', output: nested }],
    };
    const parsed = parseDocument(serializeDocument(document));
    expect(parsed.entries).toEqual([
      { kind: 'exec', lang: 'bash', code: 'cat file', output: nested },
    ]);
  });

  it('throws on a doc with no title heading', () => {
    expect(() => parseDocument('no heading here')).toThrow(/missing "# Title"/);
  });

  it('throws on an output block with no preceding code block', () => {
    const broken = ['# Broken', '', '*now*', '', '```output', 'orphan', '```', ''].join('\n');
    expect(() => parseDocument(broken)).toThrow(/no preceding code block/);
  });
});
