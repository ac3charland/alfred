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

  it('strips trailing newlines from exec code before wrapping in a fence', () => {
    // trimTrailingNewlines is called on code content inside makeFence.
    // With /\n$/ mutant, only one trailing newline is stripped; "hi\n\n" → "hi\n".
    // With '' → "Stryker was here!", the stripped newlines are replaced with garbage.
    const document: ShowboatDocument = {
      title: 'T',
      timestamp: 'now',
      entries: [{ kind: 'exec', lang: 'bash', code: 'echo hi\n\n', output: 'hi' }],
    };
    const serialized = serializeDocument(document);
    // The code fence must contain exactly "echo hi" with no trailing blank line before the closing ```
    expect(serialized).toContain('```bash\necho hi\n```');
    expect(serialized).not.toContain('echo hi\n\n');
  });

  it('strips trailing newlines from exec output before wrapping in a fence', () => {
    const document: ShowboatDocument = {
      title: 'T',
      timestamp: 'now',
      entries: [{ kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi\n\n' }],
    };
    const serialized = serializeDocument(document);
    // The output fence must contain exactly "hi" with no trailing blank line
    expect(serialized).toContain('```output\nhi\n```');
    expect(serialized).not.toContain('hi\n\n');
  });

  it('selects a longer fence when code content contains backtick runs at the line start', () => {
    // fenceTicks uses /^(`+)/ — the ^ anchor means only leading backticks on a line count.
    // An exec entry whose code contains "```" at the start of a line → need a 4-tick fence.
    const document: ShowboatDocument = {
      title: 'T',
      timestamp: 'now',
      entries: [{ kind: 'exec', lang: 'bash', code: '```nested```', output: '' }],
    };
    const serialized = serializeDocument(document);
    // Outer fence must be at least 4 backticks (longer than the 3-tick run in the code)
    expect(serialized).toMatch(/^````bash$/m);
    expect(serialized).toMatch(/^````$/m);
  });

  it('does NOT count mid-line backtick runs when computing fence depth', () => {
    // fenceTicks uses /^(`+)/ with ^ anchor — backticks not at the start of a line are ignored.
    // Without ^, "  ```indented" would increase the fence depth to 4.
    const document: ShowboatDocument = {
      title: 'T',
      timestamp: 'now',
      entries: [{ kind: 'exec', lang: 'bash', code: "echo '```'", output: '' }],
    };
    const serialized = serializeDocument(document);
    // The backticks are inside the code line, not at its start → fence stays at 3 ticks
    expect(serialized).toMatch(/^```bash$/m);
  });

  it('serializes an image entry as a bare markdown image', () => {
    const document: ShowboatDocument = {
      title: 'T',
      timestamp: 'now',
      entries: [{ kind: 'image', alt: 'screenshot', path: 'demo-image-1.png' }],
    };
    expect(serializeDocument(document)).toContain('![screenshot](demo-image-1.png)');
  });

  it('prepends a YAML front matter block when the document declares one', () => {
    const document: ShowboatDocument = {
      frontMatter: 'branch: claude/foo-bar',
      title: 'Tagged',
      timestamp: '2026-06-10T12:00:00.000Z',
      entries: [],
    };
    expect(serializeDocument(document)).toBe(
      [
        '---',
        'branch: claude/foo-bar',
        '---',
        '',
        '# Tagged',
        '',
        '*2026-06-10T12:00:00.000Z*',
        '',
      ].join('\n'),
    );
  });

  it('omits the front matter block entirely when there is none', () => {
    const document: ShowboatDocument = { title: 'Bare', timestamp: 'now', entries: [] };
    expect(serializeDocument(document)).toBe('# Bare\n\n*now*\n');
  });

  it('treats an empty front matter string as no front matter', () => {
    const document: ShowboatDocument = {
      frontMatter: '',
      title: 'Bare',
      timestamp: 'now',
      entries: [],
    };
    expect(serializeDocument(document).startsWith('---')).toBe(false);
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

  it('parses a leading YAML front matter block into frontMatter', () => {
    const md = ['---', 'branch: claude/foo-bar', '---', '', '# Tagged', '', '*now*', ''].join('\n');
    const doc = parseDocument(md);
    expect(doc.frontMatter).toBe('branch: claude/foo-bar');
    expect(doc.title).toBe('Tagged');
    expect(doc.timestamp).toBe('now');
  });

  it('round-trips a document that carries front matter', () => {
    const document: ShowboatDocument = {
      frontMatter: 'branch: feat/x',
      title: 'Round trip',
      timestamp: '2026-06-10T12:00:00.000Z',
      entries: [
        { kind: 'note', text: 'narration' },
        { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
      ],
    };
    expect(parseDocument(serializeDocument(document))).toEqual(document);
  });

  it('requires a closing --- — an unterminated leading block is not swallowed as front matter', () => {
    // With no closing fence the leading --- is not valid front matter, so the parser
    // must not silently consume the rest of the file as metadata — it fails the title scan.
    const md = ['---', 'branch: x', '# Title', '', '*now*', ''].join('\n');
    expect(() => parseDocument(md)).toThrow(/missing "# Title"/);
  });

  it('leaves frontMatter undefined for a doc without a front matter block', () => {
    const doc = parseDocument('# Plain\n\n*now*\n');
    expect(doc.frontMatter).toBeUndefined();
  });

  it('throws on an output block with no preceding code block', () => {
    const broken = ['# Broken', '', '*now*', '', '```output', 'orphan', '```', ''].join('\n');
    expect(() => parseDocument(broken)).toThrow(/no preceding code block/);
  });

  it('parses a doc with leading blank lines before the title', () => {
    // The while loop skips leading empty lines before the title.
    // The "while (false)" mutant would skip that loop and try to parse the first blank line as title.
    const md = '\n\n# Leading Blanks\n\n*ts*\n';
    const doc = parseDocument(md);
    expect(doc.title).toBe('Leading Blanks');
  });

  it('parses a doc where blank lines before the title contain only whitespace', () => {
    // line.trim() === '' is used to skip blank-ish lines; without trim(), "   " would not be skipped
    const md = '   \n# Whitespace Before\n\n*ts*\n';
    const doc = parseDocument(md);
    expect(doc.title).toBe('Whitespace Before');
  });

  it('requires # at the start of the title line — does not match # mid-line', () => {
    // Without ^ anchor on the title regex, "not a # Heading" would match and extract " Heading"
    // With ^ anchor, only lines starting with # are treated as the title
    expect(() => parseDocument('not a # Heading\n')).toThrow(/missing "# Title"/);
  });

  it('requires at least one space after # in the title', () => {
    // /^#\s+/ requires one or more whitespace after #; /^#\s/ (one whitespace only) would be a mutant
    // Verify that multiple spaces are accepted
    const md = '#   Multiple Spaces\n\n*ts*\n';
    const doc = parseDocument(md);
    expect(doc.title).toBe('Multiple Spaces');
  });

  it('trims the extracted title text', () => {
    // (titleMatch[1] ?? '').trim() — without .trim(), "  title  " stays as "  title  "
    const md = '#   trimmed title   \n\n*ts*\n';
    const doc = parseDocument(md);
    expect(doc.title).toBe('trimmed title');
  });

  it('parses a doc with blank lines between the title and the timestamp', () => {
    // The second while loop skips blank lines between title and timestamp.
    // "while (true)" mutant would infinite loop; "while (false)" would skip the loop
    // and try to parse the first blank line after the title as the timestamp.
    const md = '# Title\n\n\n\n*2026-06-10T12:00:00.000Z*\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('2026-06-10T12:00:00.000Z');
  });

  it('skips whitespace-only lines between the title and the timestamp', () => {
    // (lines[index] ?? '').trim() === '' — without .trim(), a whitespace-only line would not be
    // recognized as blank and would be parsed as the timestamp line (yielding '').
    // The MethodExpression mutant removes .trim() making the condition `'' === ''` only match pure blank.
    const md = '# Title\n   \n*my-timestamp*\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('my-timestamp');
  });

  it('requires * at the very start of the timestamp line — regex must have ^ anchor', () => {
    // /^\*(.*)\*$/ — without ^ anchor, "see the notes *2026-01-01*" ends with * and would match.
    // With ^ anchor, only lines that START with * are treated as timestamps.
    const md = '# Title\n\nsee the notes *2026-01-01*\n';
    const doc = parseDocument(md);
    // "see the notes *2026-01-01*" starts with "s", not "*" → NOT a timestamp with ^ anchor
    expect(doc.timestamp).toBe('');
    // Falls through to become a note entry
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: 'see the notes *2026-01-01*' });
  });

  it('requires * at the very end of the timestamp line — regex must have $ anchor', () => {
    // /^\*(.*)\*$/ — without $ anchor, "*ts* extra" starts with * and contains another *,
    // so the regex would match and extract "ts" regardless of the trailing "extra".
    // With $ anchor, the line must end with * to be recognized as a timestamp.
    const md = '# Title\n\n*ts* extra\n';
    const doc = parseDocument(md);
    // "*ts* extra" does NOT end with * → NOT recognized as a timestamp
    expect(doc.timestamp).toBe('');
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: '*ts* extra' });
  });

  it('extracts the timestamp correctly when the line is exactly *<timestamp>*', () => {
    const md = '# Title\n\n*2026-06-10T12:00:00.000Z*\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('2026-06-10T12:00:00.000Z');
  });

  it('trims the timestamp line before matching', () => {
    // (lines[index] ?? '').trim() is called before the regex; without trim(), "  *ts*  " won't match
    const md = '# Title\n\n  *trimmed-ts*  \n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('trimmed-ts');
  });

  it('leaves timestamp as empty string when the timestamp line is absent', () => {
    // if (timestampMatch) branch; without "if (timestampMatch)", always assigns from match
    // A doc with no timestamp line should yield timestamp=''
    const md = '# Title\n\nSome note here\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('');
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: 'Some note here' });
  });

  it('does not parse a timestamp when the line starts with "let timestamp = ..." default', () => {
    // let timestamp = '' default: mutant "Stryker was here!" would set a non-empty default
    // even when no timestamp line exists. Test that missing timestamp → empty string default.
    const md = '# Title\n\nA note\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('');
  });

  it('trims the extracted timestamp text', () => {
    // (timestampMatch[1] ?? '').trim() — without .trim(), the extracted timestamp keeps spaces
    const md = '# Title\n\n*  trimmed-ts  *\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('trimmed-ts');
  });

  it('stops note collection when a whitespace-only line is encountered within the note', () => {
    // noteLine.trim() === '' at line 137 — without .trim(), a "   " line would NOT stop the note.
    // The outer loop DOES skip whitespace-only lines globally, but inside the note inner loop
    // a whitespace-only separator between note lines would not be seen by the outer loop.
    // Construct: note content followed immediately by a whitespace-only line (no pure blank line).
    const md = '# T\n\n*ts*\n\nnote one\n   \nnote two\n';
    const doc = parseDocument(md);
    // "   " is whitespace-only → breaks the note (with trim); note one and note two are separate
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: 'note one' });
    expect(doc.entries[1]).toMatchObject({ kind: 'note', text: 'note two' });
  });

  it('stops a note token when a fence line is encountered', () => {
    // if (FENCE.test(noteLine)) break — without this break, the note would consume fence lines
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      'my note',
      '```bash',
      'echo hi',
      '```',
      '',
      '```output',
      'hi',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: 'my note' });
    expect(doc.entries[1]).toMatchObject({
      kind: 'exec',
      lang: 'bash',
      code: 'echo hi',
      output: 'hi',
    });
  });

  it('stops a note token when an image line is encountered', () => {
    // if (IMAGE.test(noteLine.trim())) break — without this break, the note would consume image lines
    const md = ['# T', '', '*ts*', '', 'my note', '![alt](shot.png)', ''].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: 'my note' });
    expect(doc.entries[1]).toMatchObject({ kind: 'image', alt: 'alt', path: 'shot.png' });
  });

  it('stops a note token when an image line with surrounding whitespace is encountered', () => {
    // IMAGE.test(noteLine.trim()) — without .trim(), "  ![alt](path)" would not stop note collection
    const md = ['# T', '', '*ts*', '', 'my note', '  ![alt](shot.png)', ''].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({ kind: 'note', text: 'my note' });
    expect(doc.entries[1]).toMatchObject({ kind: 'image', alt: 'alt', path: 'shot.png' });
  });

  it('parses an image line with surrounding whitespace', () => {
    // IMAGE.exec(line.trim()) in tokenizer — without .trim(), "  ![alt](path)  " would not parse as image
    const md = ['# T', '', '*ts*', '', '  ![the alt](shot.png)  ', ''].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'image', alt: 'the alt', path: 'shot.png' });
  });

  it('FENCE regex requires the fence to start at position 0 of the line', () => {
    // Without ^ anchor on FENCE, "  ```bash" would match — an indented fence would be parsed as a fence.
    // With ^, it is NOT a fence and gets collected as note text.
    // Use content that doesn't accidentally contain a leading-backtick line.
    const md = ['# T', '', '*ts*', '', '  ```not-a-fence', 'indented code', ''].join('\n');
    const doc = parseDocument(md);
    // With ^ anchor: indented "  ```not-a-fence" is not a fence → treated as note text
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'note' });
    expect((doc.entries[0] as { text: string }).text).toContain('```not-a-fence');
  });

  it('IMAGE regex requires the image to start at position 0 (after trim) — not embedded mid-line', () => {
    // Without ^ anchor on IMAGE regex, "prefix ![alt](path)" would match an image mid-line.
    // With ^, it does not match → treated as note text.
    const md = ['# T', '', '*ts*', '', 'see: ![alt](shot.png)', ''].join('\n');
    const doc = parseDocument(md);
    // "see: ![alt](shot.png)" is not a standalone image — must be treated as note
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'note' });
  });

  it('IMAGE regex requires the image to end at the last character — not a prefix match', () => {
    // Without $ anchor on IMAGE regex, "![alt](path)extra" would match.
    // With $, it does not match → treated as note text.
    const md = ['# T', '', '*ts*', '', '![alt](shot.png) extra text', ''].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'note' });
  });

  it('parses an exec block without a following output block — output defaults to empty string', () => {
    // else branch: entries.push({ kind: 'exec', lang, code, output: '' })
    // Without this else branch, the exec entry is never pushed
    const md = ['# T', '', '*ts*', '', '```bash', 'echo hi', '```', ''].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toEqual({ kind: 'exec', lang: 'bash', code: 'echo hi', output: '' });
  });

  it('parses the next token correctly when an exec block has no output block', () => {
    // Verifies that index advances by 1 (not -1 via -= mutant) after a no-output exec block
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```bash',
      'echo one',
      '```',
      '',
      '```bash',
      'echo two',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({ kind: 'exec', code: 'echo one', output: '' });
    expect(doc.entries[1]).toMatchObject({ kind: 'exec', code: 'echo two', output: '' });
  });

  it('only treats a fence token followed by an output fence as an exec-with-output', () => {
    // if (next?.kind === 'fence' && next.info === 'output') — conditional has many mutants.
    // Mutant "if (true)" would treat any two consecutive fences as exec+output.
    // Test: two code fences in a row (no "output" info) → two separate exec entries each with output: ''
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```bash',
      'echo one',
      '```',
      '',
      '```python',
      'print(2)',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toEqual({ kind: 'exec', lang: 'bash', code: 'echo one', output: '' });
    expect(doc.entries[1]).toEqual({ kind: 'exec', lang: 'python', code: 'print(2)', output: '' });
  });

  it('requires both kind===fence AND info===output to pair exec+output', () => {
    // Mutant "||" instead of "&&": if (next?.kind === 'fence' || next.info === 'output')
    // → a note token with kind 'note' never has info 'output'; but a fence with info 'notoutput'
    // would still be paired. This is tested by having a fence followed by a non-output fence.
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```bash',
      'echo hi',
      '```',
      '',
      '```notoutput',
      'some text',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    // First fence is NOT followed by "output" fence → two separate exec entries
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toEqual({ kind: 'exec', lang: 'bash', code: 'echo hi', output: '' });
    expect(doc.entries[1]).toEqual({
      kind: 'exec',
      lang: 'notoutput',
      code: 'some text',
      output: '',
    });
  });

  it('requires next?.kind === fence (not just info === output) to pair exec+output', () => {
    // Mutant "if (true && next.info === 'output')" would treat any token with info 'output' as output
    // This is impossible to trigger directly (non-fence tokens don't have .info) but we verify
    // the pairing only happens with exec+output adjacency
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```bash',
      'echo hi',
      '```',
      '',
      '```output',
      'hi',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    // Correct: exec with output='hi' (paired) — not two separate execs
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toEqual({ kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' });
  });

  it('parses fence info after trimming surrounding whitespace', () => {
    // (fence[2] ?? '').trim() — without .trim(), "  bash  " stays as "  bash  " in lang
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```  bash  ',
      'echo hi',
      '```',
      '',
      '```output',
      'hi',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ kind: 'exec', lang: 'bash' });
  });
});

describe('parseDocument loop boundaries and skip-loops', () => {
  it('captures every line of a multi-line fenced code block', () => {
    // Kills the fence-content loop mutants on line 124:
    //   (lines[index] ?? '') === ticks  → loop exits at first content line → code = ''
    //   index >= lines.length           → loop never runs → code = ''
    //   while (false)                    → loop never runs → code = ''
    // Assert the EXACT multi-line code, not a round-trip.
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```bash',
      'line one',
      'line two',
      'line three',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toEqual({
      kind: 'exec',
      lang: 'bash',
      code: 'line one\nline two\nline three',
      output: '',
    });
  });

  it('captures every line of a multi-line output block', () => {
    // Kills the fence-content loop mutants for the output fence as well.
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      '```bash',
      'run it',
      '```',
      '',
      '```output',
      'out one',
      'out two',
      'out three',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toEqual({
      kind: 'exec',
      lang: 'bash',
      code: 'run it',
      output: 'out one\nout two\nout three',
    });
  });

  it('captures every line of a multi-line note', () => {
    // Kills the note inner-loop mutants (line 144):
    //   index >= lines.length / while(false) → note collects nothing → text = ''
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      'note line one',
      'note line two',
      'note line three',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toEqual({
      kind: 'note',
      text: 'note line one\nnote line two\nnote line three',
    });
  });

  it('parses all entries in a multi-entry document (outer tokenize loop must iterate fully)', () => {
    // Kills the outer tokenize loop mutants (line 107) and mergeTokens loop (line 159):
    //   index >= length / while(false) → no entries parsed at all.
    const md = [
      '# T',
      '',
      '*ts*',
      '',
      'first note',
      '',
      '```bash',
      'a command',
      '```',
      '',
      '![alt](shot.png)',
      '',
      'last note',
      '',
    ].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toEqual([
      { kind: 'note', text: 'first note' },
      { kind: 'exec', lang: 'bash', code: 'a command', output: '' },
      { kind: 'image', alt: 'alt', path: 'shot.png' },
      { kind: 'note', text: 'last note' },
    ]);
  });

  it('parses the exact title text (title skip-loop must terminate correctly)', () => {
    // Kills the leading-blank skip-loop mutants (line 200):
    //   index >= length / while(false) → wrong line treated as title.
    const md = '\n\n\n# The Exact Title\n\n*2026-06-10T12:00:00.000Z*\n';
    const doc = parseDocument(md);
    expect(doc.title).toBe('The Exact Title');
  });

  it('parses the exact timestamp when it is preceded by a blank line', () => {
    // Title, blank line, *timestamp* — kills:
    //   the title-to-timestamp skip-loop mutants (line 212): index>=length / while(false)
    //     → the blank line itself would be parsed as the timestamp (yielding '').
    //   the .trim() removal at line 214's preceding while (line 212): a blank line is "" so this
    //     specific case also relies on the skip loop running exactly once.
    const md = '# Title\n\n*2026-06-10T12:00:00.000Z*\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('2026-06-10T12:00:00.000Z');
  });

  it('parses the timestamp when a whitespace-only line sits between title and timestamp', () => {
    // Kills the MethodExpression(.trim() removal) on the title→timestamp skip-loop (line 212):
    //   without .trim(), "   " is not recognized as blank → it becomes the timestamp line
    //   → timestamp parses as '' instead of the real value.
    const md = '# Title\n   \n*2026-06-10T12:00:00.000Z*\n';
    const doc = parseDocument(md);
    expect(doc.timestamp).toBe('2026-06-10T12:00:00.000Z');
  });

  it('throws on an all-blank document (title skip-loop must stop at end of input)', () => {
    // Kills ConditionalExpression "true &&" on the title skip-loop (line 197):
    //   with the real `index < lines.length` guard, the loop stops at end → titleMatch on ''
    //   → throws "missing title". With "true &&", the loop runs off the end where every
    //   undefined→'' line is blank → infinite loop → Stryker timeout (counted as killed).
    expect(() => parseDocument('\n'.repeat(3))).toThrow(/missing "# Title"/);
  });

  it('parses a doc that has only a title and trailing blank lines (timestamp skip-loop stops at EOF)', () => {
    // Kills ConditionalExpression "true &&" on the timestamp skip-loop (line 209):
    //   after the title, the rest of the doc is blank lines. The real `index < lines.length`
    //   guard stops the skip-loop at end → no timestamp, no entries. With "true &&" the loop
    //   runs off the end (every undefined→'' line is blank) → infinite loop → timeout (killed).
    const doc = parseDocument('# Only Title\n\n\n\n');
    expect(doc.title).toBe('Only Title');
    expect(doc.timestamp).toBe('');
    expect(doc.entries).toEqual([]);
  });

  it('captures all content of an unclosed fence at end of file', () => {
    // The fence-content loop's index < lines.length guard handles an unclosed fence at EOF.
    // With the < → <= mutant, one extra undefined→'' line is appended to content.
    // markdown.split('\n') on a doc ending in '\n' yields a trailing '' element already, so the
    // unclosed-fence content here is asserted EXACTLY to detect any extra/missing trailing line.
    const md = ['# T', '', '*ts*', '', '```bash', 'unclosed one', 'unclosed two'].join('\n');
    const doc = parseDocument(md);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toEqual({
      kind: 'exec',
      lang: 'bash',
      code: 'unclosed one\nunclosed two',
      output: '',
    });
  });
});
