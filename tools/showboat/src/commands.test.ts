import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  exec,
  extract,
  formatDemoLink,
  image,
  init,
  note,
  pop,
  prLink,
  verify,
  video,
} from './commands.ts';
import { parseDocument } from './document.ts';

function tempDoc(): { file: string; directory: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'showboat-'));
  return { file: path.join(directory, 'demo.md'), directory };
}

function entriesOf(file: string) {
  return parseDocument(readFileSync(file, 'utf8')).entries;
}

const failingConvert = (): Promise<Uint8Array> => Promise.reject(new Error('convert failed'));

describe('init', () => {
  it('writes the title and an ISO-8601 timestamp', () => {
    const { file } = tempDoc();
    init(file, 'My Demo', new Date('2026-06-10T12:00:00.000Z'));
    const document = parseDocument(readFileSync(file, 'utf8'));
    expect(document.title).toBe('My Demo');
    expect(document.timestamp).toBe('2026-06-10T12:00:00.000Z');
    expect(document.entries).toEqual([]);
  });

  it('creates missing parent folders so a doc can land in its branch folder', () => {
    const { directory } = tempDoc();
    // A branch name with a slash nests; init must create the whole chain.
    const nested = path.join(directory, 'claude', 'feat-x', 'demo.md');
    init(nested, 'Nested', new Date('2026-06-10T12:00:00.000Z'));
    expect(existsSync(nested)).toBe(true);
  });

  it('creates a doc with exactly zero entries — serialized file contains nothing beyond header', () => {
    const { file } = tempDoc();
    init(file, 'Empty', new Date('2026-01-01T00:00:00.000Z'));
    const raw = readFileSync(file, 'utf8');
    // Exact expected serialization: header line, blank line, italic timestamp, trailing newline.
    // If entries were non-empty (e.g. ["Stryker was here"]), join() would add \n\n + the stringified
    // entry (undefined → empty string) resulting in a longer file.
    expect(raw).toBe('# Empty\n\n*2026-01-01T00:00:00.000Z*\n');
  });
});

describe('note', () => {
  it('appends a commentary entry', () => {
    const { file } = tempDoc();
    init(file, 'D');
    note(file, 'hello world');
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'hello world' }]);
  });

  it('strips a single trailing newline', () => {
    const { file } = tempDoc();
    init(file, 'D');
    note(file, 'trimmed\n');
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'trimmed' }]);
  });

  it('strips multiple consecutive trailing newlines, not just one', () => {
    const { file } = tempDoc();
    init(file, 'D');
    note(file, 'trimmed\n\n\n');
    // After stripping ALL trailing newlines, the serialized file ends with "trimmed\n" (one newline
    // from serializeDocument's trailing \n). With /\n$/ as the mutant (strips only one newline),
    // "trimmed\n\n" remains in the entry → file ends with "trimmed\n\n\n", not "trimmed\n".
    const raw = readFileSync(file, 'utf8');
    expect(raw).toMatch(/trimmed\n$/);
  });

  it('preserves a mid-string newline while stripping only the trailing ones', () => {
    const { file } = tempDoc();
    init(file, 'D');
    note(file, 'line one\nline two\n');
    const entries = entriesOf(file);
    expect(entries).toHaveLength(1);
    // Mid-string newline must be preserved
    expect((entries[0] as { text: string }).text).toContain('\n');
    // But trailing newline must be gone
    expect((entries[0] as { text: string }).text).not.toMatch(/\n$/);
  });
});

describe('exec', () => {
  it('captures command output and returns exit code 0', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const result = exec(file, 'bash', 'echo hello', directory);
    expect(result).toEqual({ output: 'hello', status: 0 });
    expect(entriesOf(file)).toEqual([
      { kind: 'exec', lang: 'bash', code: 'echo hello', output: 'hello' },
    ]);
  });

  it('combines stderr and propagates a non-zero exit code', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const result = exec(file, 'bash', 'echo boom >&2; exit 3', directory);
    expect(result).toEqual({ output: 'boom', status: 3 });
  });

  it('runs JavaScript when the language is node', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    expect(exec(file, 'node', 'console.log(2 + 3)', directory)).toEqual({ output: '5', status: 0 });
  });

  it('runs the command in the given workdir', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const result = exec(file, 'bash', 'pwd', directory);
    expect(result.output.endsWith(path.basename(directory))).toBe(true);
  });

  it('strips a single trailing newline from code before serializing', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    exec(file, 'bash', 'echo hi\n', directory);
    expect(entriesOf(file)).toEqual([
      { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
    ]);
    // Check raw serialized content: the fenced code block must not have a trailing blank line
    // before the closing fence. With the trailing newline stripped, the block is:
    //   ```bash\necho hi\n```
    // With a trailing newline NOT stripped, makeFence's trimTrailingNewlines would catch it,
    // so for a single trailing newline both paths converge — verified via parse round-trip above.
  });

  it('strips multiple consecutive trailing newlines from code, not just one', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    exec(file, 'bash', 'echo hi\n\n\n', directory);
    // The parsed entry must still have code='echo hi' (makeFence trims trailing newlines too,
    // so this is consistent with AT_CEILING for the /\n$/ mutant which only removes one \n)
    expect(entriesOf(file)).toEqual([
      { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
    ]);
  });

  it('preserves a mid-code newline while stripping only the trailing ones', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    exec(file, 'bash', 'echo line1\necho line2\n', directory);
    const entries = entriesOf(file);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as { kind: string; code: string };
    // Mid-string newline must be preserved
    expect(entry.code).toContain('\n');
    // But trailing newline must be gone
    expect(entry.code).not.toMatch(/\n$/);
  });
});

describe('pop', () => {
  it('removes the most recent entry, including an exec block and its output', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    note(file, 'keep me');
    exec(file, 'bash', 'echo gone', directory);
    const removed = pop(file);
    expect(removed).toEqual({ kind: 'exec', lang: 'bash', code: 'echo gone', output: 'gone' });
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'keep me' }]);
  });
});

describe('image', () => {
  it('copies the source next to the doc and references a generated name', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'screenshot.png');
    writeFileSync(source, 'fake-png-bytes');
    image(file, source);
    expect(entriesOf(file)).toEqual([{ kind: 'image', alt: '', path: 'demo-image-1.png' }]);
    expect(existsSync(path.join(directory, 'demo-image-1.png'))).toBe(true);
  });

  it('parses an ![alt](path) argument for the alt text', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'pic.png');
    writeFileSync(source, 'x');
    image(file, `![home page](${source})`);
    expect(entriesOf(file)).toEqual([
      { kind: 'image', alt: 'home page', path: 'demo-image-1.png' },
    ]);
  });

  it('uses an empty string for alt when the markdown alt is empty', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, 'x');
    image(file, `![](${source})`);
    const entries = entriesOf(file);
    expect(entries[0]).toMatchObject({ kind: 'image', alt: '' });
  });

  it('does not match markdown embedded after a prefix — regex must be anchored at the start', () => {
    // Without a ^ anchor, "prefix![alt](src)" would be parsed as markdown and alt would be "alt".
    // With ^, it is treated as a bare path, so alt="" and copyFileSync uses the whole string as path.
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, 'x');
    // "prefix![alt](source)" — with ^ anchor, no regex match → treated as bare path → ENOENT
    // Without ^ anchor → matches, copies correctly, alt="alt"
    expect(() => {
      image(file, `prefix![alt](${source})`);
    }).toThrow(/ENOENT/);
  });

  it('does not match markdown followed by trailing text — regex must be anchored at the end', () => {
    // Without a $ anchor, "![alt](src)suffix" would match and extract src correctly.
    // With $, it is treated as a bare path → ENOENT (the whole string is used as path).
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, 'x');
    // "![alt](source)suffix" — with $ anchor, no match → bare path → ENOENT
    // Without $ anchor → matches, copies from real source, alt="alt"
    expect(() => {
      image(file, `![alt](${source})suffix`);
    }).toThrow(/ENOENT/);
  });

  it('strips surrounding whitespace from argument before matching markdown', () => {
    // trim() is called before the regex. Without trim(), "  ![alt](src)  " would not match ^.
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'trimmed.png');
    writeFileSync(source, 'x');
    image(file, `  ![trim test](${source})  `);
    expect(entriesOf(file)[0]).toMatchObject({ kind: 'image', alt: 'trim test' });
  });

  it('uses .png as extension fallback for sources without an extension', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const source = path.join(directory, 'screenshot');
    writeFileSync(source, 'x');
    image(file, source);
    const entries = entriesOf(file);
    expect(entries[0]).toMatchObject({ kind: 'image', path: 'demo-image-1.png' });
  });

  it('increments the image count for the second image in the document', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const src1 = path.join(directory, 'a.png');
    const src2 = path.join(directory, 'b.png');
    writeFileSync(src1, 'x');
    writeFileSync(src2, 'x');
    image(file, src1);
    image(file, src2);
    const entries = entriesOf(file);
    expect(entries[0]).toMatchObject({ path: 'demo-image-1.png' });
    expect(entries[1]).toMatchObject({ path: 'demo-image-2.png' });
  });

  it('counts only existing image entries, not all entries', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    // Add a note entry first — it must NOT count toward the image numbering
    note(file, 'some note');
    const src = path.join(directory, 'shot.png');
    writeFileSync(src, 'x');
    image(file, src);
    const entries = entriesOf(file);
    // The image is the second entry (after the note), but it should be numbered "1"
    expect(entries[1]).toMatchObject({ kind: 'image', path: 'demo-image-1.png' });
  });
});

describe('video', () => {
  const fakeGif = Buffer.from('GIF89a-fake-bytes');
  // A converter that records the path it was handed and returns fixed GIF bytes,
  // so the orchestration is exercised without running ffmpeg.wasm.
  function fakeConvert(calls: string[]): (webmPath: string) => Promise<Uint8Array> {
    return (webmPath) => {
      calls.push(webmPath);
      return Promise.resolve(fakeGif);
    };
  }

  it('writes the converted gif next to the doc, embeds it, and deletes the webm', async () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'fake-webm-bytes');

    await video(file, webm, '', fakeConvert([]));

    expect(entriesOf(file)).toEqual([{ kind: 'image', alt: '', path: 'demo-video-1.gif' }]);
    const gifPath = path.join(directory, 'demo-video-1.gif');
    expect(existsSync(gifPath)).toBe(true);
    expect(readFileSync(gifPath)).toEqual(fakeGif);
    expect(existsSync(webm)).toBe(false);
  });

  it('uses the provided alt text for the embedded gif', async () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');

    await video(file, webm, 'inbox reveal', fakeConvert([]));

    expect(entriesOf(file)[0]).toMatchObject({
      kind: 'image',
      alt: 'inbox reveal',
      path: 'demo-video-1.gif',
    });
  });

  it('hands the webm path to the converter', async () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');
    const calls: string[] = [];

    await video(file, webm, '', fakeConvert(calls));

    expect(calls).toEqual([webm]);
  });

  it('numbers gifs after existing image entries so files never collide', async () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const png = path.join(directory, 'a.png');
    writeFileSync(png, 'x');
    image(file, png);
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');

    await video(file, webm, '', fakeConvert([]));

    expect(entriesOf(file)[1]).toMatchObject({ kind: 'image', path: 'demo-video-2.gif' });
  });

  it('preserves the webm and writes nothing when conversion fails', async () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');

    await expect(video(file, webm, '', failingConvert)).rejects.toThrow('convert failed');

    expect(existsSync(webm)).toBe(true);
    expect(existsSync(path.join(directory, 'demo-video-1.gif'))).toBe(false);
    expect(entriesOf(file)).toEqual([]);
  });
});

describe('verify', () => {
  it('passes when recorded output still matches', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    exec(file, 'bash', 'echo stable', directory);
    expect(verify(file, directory)).toEqual({ ok: true, diffs: [], checked: 1 });
  });

  it('fails with a diff when the recorded output no longer matches', () => {
    const { file, directory } = tempDoc();
    // A fixed timestamp with no 4/9 digits and a command whose code text contains
    // neither, so tampering the recorded "4" hits only the output block.
    init(file, 'D', new Date('2026-01-01T00:00:00.000Z'));
    exec(file, 'bash', 'echo $((6 - 2))', directory);
    writeFileSync(file, readFileSync(file, 'utf8').replace('4', '9'));
    const result = verify(file, directory);
    expect(result.ok).toBe(false);
    expect(result.diffs).toEqual([
      { index: 1, lang: 'bash', code: 'echo $((6 - 2))', expected: '9', actual: '4' },
    ]);
  });

  it('--output writes a refreshed copy without touching the original', () => {
    const { file, directory } = tempDoc();
    init(file, 'D', new Date('2026-01-01T00:00:00.000Z'));
    exec(file, 'bash', 'echo $((6 - 2))', directory);
    writeFileSync(file, readFileSync(file, 'utf8').replace('4', '9'));
    const out = path.join(directory, 'refreshed.md');
    verify(file, directory, out);
    expect(readFileSync(file, 'utf8')).toContain('9'); // original left tampered
    expect(readFileSync(out, 'utf8')).toContain('4'); // refreshed has the real output
  });

  it('skips note and image entries and only counts exec blocks', () => {
    const { file, directory } = tempDoc();
    init(file, 'D');
    note(file, 'some narration');
    exec(file, 'bash', 'echo counted', directory);
    // Add an image entry manually by writing raw markdown into the file
    const raw = readFileSync(file, 'utf8');
    writeFileSync(file, raw + '\n![alt](demo-image-1.png)\n');
    const result = verify(file, directory);
    // Only the exec block is checked; note and image are skipped
    expect(result.checked).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('extract', () => {
  it('emits showboat commands that recreate the doc', () => {
    const { file, directory } = tempDoc();
    init(file, 'Title');
    note(file, "it's fine");
    exec(file, 'bash', 'echo hi', directory);
    expect(extract(file, 'copy.md').split('\n')).toEqual([
      "showboat init 'copy.md' 'Title'",
      String.raw`showboat note 'copy.md' 'it'\''s fine'`,
      "showboat exec 'copy.md' 'bash' 'echo hi'",
    ]);
  });

  it('includes image entries as showboat image commands', () => {
    const { file, directory } = tempDoc();
    init(file, 'Title');
    const src = path.join(directory, 'shot.png');
    writeFileSync(src, 'x');
    image(file, `![the caption](${src})`);
    const lines = extract(file, 'out.md').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("showboat init 'out.md' 'Title'");
    expect(lines[1]).toBe("showboat image 'out.md' '![the caption](demo-image-1.png)'");
  });

  it('falls back to bash when the exec lang is empty', () => {
    const { file, directory } = tempDoc();
    init(file, 'Title');
    exec(file, '', 'echo hi', directory);
    const lines = extract(file, 'out.md').split('\n');
    // lang should be 'bash' not ''
    expect(lines[1]).toBe("showboat exec 'out.md' 'bash' 'echo hi'");
  });

  it('preserves the actual lang when lang is not empty', () => {
    const { file, directory } = tempDoc();
    init(file, 'Title');
    exec(file, 'node', 'console.log(1)', directory);
    const lines = extract(file, 'out.md').split('\n');
    expect(lines[1]).toBe("showboat exec 'out.md' 'node' 'console.log(1)'");
  });
});

describe('formatDemoLink', () => {
  const link =
    '📝 **Demo:** [docs/demos/x.md](https://github.com/ac3charland/alfred/blob/main/docs/demos/x.md)';

  it('builds a github blob link from an SSH remote', () => {
    expect(formatDemoLink('git@github.com:ac3charland/alfred.git', 'main', 'docs/demos/x.md')).toBe(
      link,
    );
  });

  it('handles an HTTPS remote with and without the .git suffix', () => {
    expect(
      formatDemoLink('https://github.com/ac3charland/alfred.git', 'main', 'docs/demos/x.md'),
    ).toBe(link);
    expect(formatDemoLink('https://github.com/ac3charland/alfred', 'main', 'docs/demos/x.md')).toBe(
      link,
    );
  });

  it('handles the sandbox local git proxy URL (extra /git/ path prefix, non-github host)', () => {
    expect(
      formatDemoLink('http://127.0.0.1:41663/git/ac3charland/alfred', 'main', 'docs/demos/x.md'),
    ).toBe(link);
  });

  it('handles a proxy URL with userinfo (user@host)', () => {
    expect(
      formatDemoLink(
        'http://local_proxy@127.0.0.1:34699/git/ac3charland/alfred',
        'main',
        'docs/demos/x.md',
      ),
    ).toBe(link);
  });

  it('keeps slashes in a branch name (github resolves the ref)', () => {
    expect(formatDemoLink('https://github.com/o/r', 'claude/foo-bar', 'docs/demos/x.md')).toBe(
      '📝 **Demo:** [docs/demos/x.md](https://github.com/o/r/blob/claude/foo-bar/docs/demos/x.md)',
    );
  });

  it('normalizes a leading ./ and backslashes in the doc path', () => {
    expect(formatDemoLink('https://github.com/o/r', 'main', String.raw`./docs\demos\x.md`)).toBe(
      '📝 **Demo:** [docs/demos/x.md](https://github.com/o/r/blob/main/docs/demos/x.md)',
    );
  });

  it('throws when owner/repo cannot be parsed from the remote', () => {
    expect(() => formatDemoLink('not-a-url', 'main', 'd.md')).toThrow(/owner\/repo/);
  });
});

describe('prLink', () => {
  it('formats the link from an injected git context (no real repo needed)', () => {
    expect(
      prLink('docs/demos/x.md', { remoteUrl: 'git@github.com:o/r.git', branch: 'feat/x' }),
    ).toBe('📝 **Demo:** [docs/demos/x.md](https://github.com/o/r/blob/feat/x/docs/demos/x.md)');
  });
});
