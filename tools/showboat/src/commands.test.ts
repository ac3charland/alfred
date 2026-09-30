import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SecretError,
  UsageError,
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

// Assembled at runtime so this file stays clean under the repo's own secret scan.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const LEAKED_URI = `postgresql://postgres.ref:${PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;

function tempDoc(): { file: string; directory: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'showboat-'));
  return { file: path.join(directory, 'demo.md'), directory };
}

/** The doc's bytes and the folder's file list: a refusal must leave both exactly as they were. */
function snapshot(file: string): { doc: string; files: Set<string> } {
  return { doc: readFileSync(file, 'utf8'), files: new Set(readdirSync(path.dirname(file))) };
}

function entriesOf(file: string) {
  return parseDocument(readFileSync(file, 'utf8')).entries;
}

// The signature every real PNG opens with; `image` refuses anything that isn't an image.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const failingConvert = (): Promise<Uint8Array> => Promise.reject(new Error('convert failed'));

describe('init', () => {
  it('writes the title and an ISO-8601 timestamp', async () => {
    const { file } = tempDoc();
    await init(file, 'My Demo', { now: new Date('2026-06-10T12:00:00.000Z') });
    const document = parseDocument(readFileSync(file, 'utf8'));
    expect(document.title).toBe('My Demo');
    expect(document.timestamp).toBe('2026-06-10T12:00:00.000Z');
    expect(document.entries).toEqual([]);
  });

  it('creates missing parent folders so a doc can land in its own folder', async () => {
    const { directory } = tempDoc();
    // A semantic folder name may nest; init must create the whole chain.
    const nested = path.join(directory, 'cool', 'feature', 'demo.md');
    await init(nested, 'Nested', { now: new Date('2026-06-10T12:00:00.000Z') });
    expect(existsSync(nested)).toBe(true);
  });

  it('creates a doc with exactly zero entries — serialized file contains nothing beyond header', async () => {
    const { file } = tempDoc();
    await init(file, 'Empty', { now: new Date('2026-01-01T00:00:00.000Z') });
    const raw = readFileSync(file, 'utf8');
    // Exact expected serialization: header line, blank line, italic timestamp, trailing newline.
    // If entries were non-empty (e.g. ["Stryker was here"]), join() would add \n\n + the stringified
    // entry (undefined → empty string) resulting in a longer file.
    expect(raw).toBe('# Empty\n\n*2026-01-01T00:00:00.000Z*\n');
  });

  it('stamps the branch into YAML front matter when one is given', async () => {
    const { file } = tempDoc();
    await init(file, 'Tagged', {
      branch: 'claude/foo-bar',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(readFileSync(file, 'utf8')).toBe(
      '---\nbranch: claude/foo-bar\n---\n\n# Tagged\n\n*2026-01-01T00:00:00.000Z*\n',
    );
  });

  it('writes no front matter when the branch is empty or omitted', async () => {
    const { file } = tempDoc();
    await init(file, 'Untagged', { branch: '', now: new Date('2026-01-01T00:00:00.000Z') });
    expect(readFileSync(file, 'utf8').startsWith('---')).toBe(false);
  });

  it('keeps the branch front matter through a later note (load/save round-trip)', async () => {
    const { file } = tempDoc();
    await init(file, 'Tagged', { branch: 'feat/x', now: new Date('2026-01-01T00:00:00.000Z') });
    await note(file, 'a later edit');
    expect(parseDocument(readFileSync(file, 'utf8')).frontMatter).toBe('branch: feat/x');
  });
});

describe('note', () => {
  it('appends a commentary entry', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    await note(file, 'hello world');
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'hello world' }]);
  });

  it('strips a single trailing newline', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    await note(file, 'trimmed\n');
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'trimmed' }]);
  });

  it('strips multiple consecutive trailing newlines, not just one', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    await note(file, 'trimmed\n\n\n');
    // After stripping ALL trailing newlines, the serialized file ends with "trimmed\n" (one newline
    // from serializeDocument's trailing \n). With /\n$/ as the mutant (strips only one newline),
    // "trimmed\n\n" remains in the entry → file ends with "trimmed\n\n\n", not "trimmed\n".
    const raw = readFileSync(file, 'utf8');
    expect(raw).toMatch(/trimmed\n$/);
  });

  it('preserves a mid-string newline while stripping only the trailing ones', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    await note(file, 'line one\nline two\n');
    const entries = entriesOf(file);
    expect(entries).toHaveLength(1);
    // Mid-string newline must be preserved
    expect((entries[0] as { text: string }).text).toContain('\n');
    // But trailing newline must be gone
    expect((entries[0] as { text: string }).text).not.toMatch(/\n$/);
  });
});

describe('exec', () => {
  it('captures command output and returns exit code 0', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const result = await exec(file, 'bash', 'echo hello', directory);
    expect(result).toEqual({ output: 'hello', status: 0 });
    expect(entriesOf(file)).toEqual([
      { kind: 'exec', lang: 'bash', code: 'echo hello', output: 'hello' },
    ]);
  });

  it('combines stderr and propagates a non-zero exit code', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const result = await exec(file, 'bash', 'echo boom >&2; exit 3', directory);
    expect(result).toEqual({ output: 'boom', status: 3 });
  });

  it('runs JavaScript when the language is node', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    expect(await exec(file, 'node', 'console.log(2 + 3)', directory)).toEqual({
      output: '5',
      status: 0,
    });
  });

  it('runs the command in the given workdir', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const result = await exec(file, 'bash', 'pwd', directory);
    expect(result.output.endsWith(path.basename(directory))).toBe(true);
  });

  it('strips a single trailing newline from code before serializing', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await exec(file, 'bash', 'echo hi\n', directory);
    expect(entriesOf(file)).toEqual([
      { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
    ]);
    // Check raw serialized content: the fenced code block must not have a trailing blank line
    // before the closing fence. With the trailing newline stripped, the block is:
    //   ```bash\necho hi\n```
    // With a trailing newline NOT stripped, makeFence's trimTrailingNewlines would catch it,
    // so for a single trailing newline both paths converge — verified via parse round-trip above.
  });

  it('strips multiple consecutive trailing newlines from code, not just one', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await exec(file, 'bash', 'echo hi\n\n\n', directory);
    // The parsed entry must still have code='echo hi' (makeFence trims trailing newlines too,
    // so this is consistent with AT_CEILING for the /\n$/ mutant which only removes one \n)
    expect(entriesOf(file)).toEqual([
      { kind: 'exec', lang: 'bash', code: 'echo hi', output: 'hi' },
    ]);
  });

  it('preserves a mid-code newline while stripping only the trailing ones', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await exec(file, 'bash', 'echo line1\necho line2\n', directory);
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
  it('removes the most recent entry, including an exec block and its output', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await note(file, 'keep me');
    await exec(file, 'bash', 'echo gone', directory);
    const removed = await pop(file);
    expect(removed).toEqual({ kind: 'exec', lang: 'bash', code: 'echo gone', output: 'gone' });
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'keep me' }]);
  });
});

describe('image', () => {
  it('copies the source next to the doc and references a generated name', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'screenshot.png');
    writeFileSync(source, PNG);
    await image(file, source);
    expect(entriesOf(file)).toEqual([{ kind: 'image', alt: '', path: 'demo-image-1.png' }]);
    expect(existsSync(path.join(directory, 'demo-image-1.png'))).toBe(true);
  });

  it('parses an ![alt](path) argument for the alt text', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'pic.png');
    writeFileSync(source, PNG);
    await image(file, `![home page](${source})`);
    expect(entriesOf(file)).toEqual([
      { kind: 'image', alt: 'home page', path: 'demo-image-1.png' },
    ]);
  });

  it('uses an empty string for alt when the markdown alt is empty', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, PNG);
    await image(file, `![](${source})`);
    const entries = entriesOf(file);
    expect(entries[0]).toMatchObject({ kind: 'image', alt: '' });
  });

  it('does not match markdown embedded after a prefix — regex must be anchored at the start', async () => {
    // Without a ^ anchor, "prefix![alt](src)" would be parsed as markdown and alt would be "alt".
    // With ^, it is treated as a bare path, so alt="" and copyFileSync uses the whole string as path.
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, PNG);
    // "prefix![alt](source)" — with ^ anchor, no regex match → treated as bare path → ENOENT
    // Without ^ anchor → matches, copies correctly, alt="alt"
    await expect(image(file, `prefix![alt](${source})`)).rejects.toThrow(/ENOENT/);
  });

  it('does not match markdown followed by trailing text — regex must be anchored at the end', async () => {
    // Without a $ anchor, "![alt](src)suffix" would match and extract src correctly.
    // With $, it is treated as a bare path → ENOENT (the whole string is used as path).
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, PNG);
    // "![alt](source)suffix" — with $ anchor, no match → bare path → ENOENT
    // Without $ anchor → matches, copies from real source, alt="alt"
    await expect(image(file, `![alt](${source})suffix`)).rejects.toThrow(/ENOENT/);
  });

  it('strips surrounding whitespace from argument before matching markdown', async () => {
    // trim() is called before the regex. Without trim(), "  ![alt](src)  " would not match ^.
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'trimmed.png');
    writeFileSync(source, PNG);
    await image(file, `  ![trim test](${source})  `);
    expect(entriesOf(file)[0]).toMatchObject({ kind: 'image', alt: 'trim test' });
  });

  it('uses .png as extension fallback for sources without an extension', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'screenshot');
    writeFileSync(source, PNG);
    await image(file, source);
    const entries = entriesOf(file);
    expect(entries[0]).toMatchObject({ kind: 'image', path: 'demo-image-1.png' });
  });

  it('increments the image count for the second image in the document', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const src1 = path.join(directory, 'a.png');
    const src2 = path.join(directory, 'b.png');
    writeFileSync(src1, PNG);
    writeFileSync(src2, PNG);
    await image(file, src1);
    await image(file, src2);
    const entries = entriesOf(file);
    expect(entries[0]).toMatchObject({ path: 'demo-image-1.png' });
    expect(entries[1]).toMatchObject({ path: 'demo-image-2.png' });
  });

  it.each([
    ['GIF', Buffer.from('GIF89a-bytes')],
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
    ['WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])],
    ['SVG', Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ])('accepts a %s source', async (_name, bytes) => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'pic.bin');
    writeFileSync(source, bytes);
    await image(file, source);
    expect(readFileSync(path.join(directory, 'demo-image-1.bin'))).toEqual(bytes);
  });

  it('refuses a source that is not an image, copying nothing', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, '.env.local');
    writeFileSync(source, 'SOME_SETTING=plain-text\n');
    const before = readFileSync(file, 'utf8');
    const files = new Set(readdirSync(directory));
    const refusal = image(file, source);
    await expect(refusal).rejects.toThrow(UsageError);
    await expect(refusal).rejects.toThrow(/not an image/);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(new Set(readdirSync(directory))).toEqual(files);
  });

  it('refuses a text file dressed up with an image extension', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'notes.png');
    writeFileSync(source, 'just words');
    await expect(image(file, source)).rejects.toThrow(UsageError);
    expect(existsSync(path.join(directory, 'demo-image-1.png'))).toBe(false);
  });

  it('refuses an SVG whose text carries a secret, copying nothing', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'leak.svg');
    writeFileSync(
      source,
      `<svg xmlns="http://www.w3.org/2000/svg"><text>${LEAKED_URI}</text></svg>`,
    );
    const before = readFileSync(file, 'utf8');
    const files = new Set(readdirSync(directory));
    await expect(image(file, source)).rejects.toThrow(SecretError);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(new Set(readdirSync(directory))).toEqual(files);
  });

  it('counts only existing image entries, not all entries', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    // Add a note entry first — it must NOT count toward the image numbering
    await note(file, 'some note');
    const src = path.join(directory, 'shot.png');
    writeFileSync(src, PNG);
    await image(file, src);
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
    await init(file, 'D');
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
    await init(file, 'D');
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
    await init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');
    const calls: string[] = [];

    await video(file, webm, '', fakeConvert(calls));

    expect(calls).toEqual([webm]);
  });

  it('numbers gifs after existing image entries so files never collide', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const png = path.join(directory, 'a.png');
    writeFileSync(png, PNG);
    await image(file, png);
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');

    await video(file, webm, '', fakeConvert([]));

    expect(entriesOf(file)[1]).toMatchObject({ kind: 'image', path: 'demo-video-2.gif' });
  });

  it('numbers the gif by image entries only, ignoring notes', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await note(file, 'a note'); // a non-image entry must NOT bump the gif number
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');

    await video(file, webm, '', fakeConvert([]));

    // The note is entry 0; the gif is entry 1 but must still be numbered "1" (zero prior images).
    expect(entriesOf(file)[1]).toMatchObject({ kind: 'image', path: 'demo-video-1.gif' });
  });

  it('preserves the webm and writes nothing when conversion fails', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');

    await expect(video(file, webm, '', failingConvert)).rejects.toThrow('convert failed');

    expect(existsSync(webm)).toBe(true);
    expect(existsSync(path.join(directory, 'demo-video-1.gif'))).toBe(false);
    expect(entriesOf(file)).toEqual([]);
  });
});

describe('verify', () => {
  it('passes when recorded output still matches', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await exec(file, 'bash', 'echo stable', directory);
    expect(await verify(file, directory)).toEqual({ ok: true, diffs: [], checked: 1 });
  });

  it('fails with a diff when the recorded output no longer matches', async () => {
    const { file, directory } = tempDoc();
    // A fixed timestamp with no 4/9 digits and a command whose code text contains
    // neither, so tampering the recorded "4" hits only the output block.
    await init(file, 'D', { now: new Date('2026-01-01T00:00:00.000Z') });
    await exec(file, 'bash', 'echo $((6 - 2))', directory);
    writeFileSync(file, readFileSync(file, 'utf8').replace('4', '9'));
    const result = await verify(file, directory);
    expect(result.ok).toBe(false);
    expect(result.diffs).toEqual([
      { index: 1, lang: 'bash', code: 'echo $((6 - 2))', expected: '9', actual: '4' },
    ]);
  });

  it('--output writes a refreshed copy without touching the original', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D', { now: new Date('2026-01-01T00:00:00.000Z') });
    await exec(file, 'bash', 'echo $((6 - 2))', directory);
    writeFileSync(file, readFileSync(file, 'utf8').replace('4', '9'));
    const out = path.join(directory, 'refreshed.md');
    await verify(file, directory, out);
    expect(readFileSync(file, 'utf8')).toContain('9'); // original left tampered
    expect(readFileSync(out, 'utf8')).toContain('4'); // refreshed has the real output
  });

  it('skips note and image entries and only counts exec blocks', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    await note(file, 'some narration');
    await exec(file, 'bash', 'echo counted', directory);
    // Add an image entry manually by writing raw markdown into the file
    const raw = readFileSync(file, 'utf8');
    writeFileSync(file, raw + '\n![alt](demo-image-1.png)\n');
    const result = await verify(file, directory);
    // Only the exec block is checked; note and image are skipped
    expect(result.checked).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('secret guard', () => {
  // Prints LEAKED_URI without the command text itself containing it.
  const PRINT_LEAK = `node -e "console.log(['postgresql://postgres.ref:', '${['Qz7', 'vLk2'].join('')}' + 'Rw9pT', '@h.example.com:5432/postgres'].join(''))"`;

  it('note refuses to record a secret, leaves the doc untouched, and never echoes the secret', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    const before = readFileSync(file, 'utf8');
    const refusal = note(file, `connect with ${LEAKED_URI}`);
    await expect(refusal).rejects.toThrow(SecretError);
    await expect(refusal).rejects.toThrow(/npm run psql -w database/);
    await expect(refusal).rejects.not.toThrow(PASSWORD);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('exec refuses a command that inlines a secret — without running it', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const before = readFileSync(file, 'utf8');
    await expect(exec(file, 'bash', `touch ran; echo '${LEAKED_URI}'`, directory)).rejects.toThrow(
      SecretError,
    );
    expect(existsSync(path.join(directory, 'ran'))).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('exec refuses when only the output carries a secret', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const before = readFileSync(file, 'utf8');
    await expect(exec(file, 'bash', PRINT_LEAK, directory)).rejects.toThrow(/output/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('the refusal steers to psql or a pre-exported credential, never an inline NAME=value', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    const refusal = note(file, LEAKED_URI);
    await expect(refusal).rejects.toThrow(/npm run psql -w database -- -c/);
    await expect(refusal).rejects.toThrow(/exported in your shell outside the recorded command/);
    await expect(refusal).rejects.toThrow(/never `NAME=value` inside it/);
    await expect(refusal).rejects.not.toThrow(/"\$NAME"/);
  });

  it('init refuses a title carrying a secret, overwriting nothing and creating no folder', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const before = snapshot(file);
    await expect(init(file, `Demo of ${LEAKED_URI}`)).rejects.toThrow(SecretError);
    expect(snapshot(file)).toEqual(before);

    const nested = path.join(directory, 'new-folder', 'demo.md');
    await expect(init(nested, `Demo of ${LEAKED_URI}`)).rejects.toThrow(SecretError);
    expect(existsSync(path.dirname(nested))).toBe(false);
  });

  it('init refuses a --branch carrying a secret', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    const before = snapshot(file);
    await expect(init(file, 'D', { branch: LEAKED_URI })).rejects.toThrow(SecretError);
    expect(snapshot(file)).toEqual(before);
  });

  it('image refuses alt text carrying a secret, copying nothing', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const source = path.join(directory, 'shot.png');
    writeFileSync(source, PNG);
    const before = snapshot(file);
    const refusal = image(file, `![${LEAKED_URI}](${source})`);
    await expect(refusal).rejects.toThrow(SecretError);
    await expect(refusal).rejects.not.toThrow(PASSWORD);
    expect(snapshot(file)).toEqual(before);
  });

  it('video refuses alt text carrying a secret — before converting, keeping the webm', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const webm = path.join(directory, 'clip.webm');
    writeFileSync(webm, 'x');
    const before = snapshot(file);
    const converted: string[] = [];
    const convert = (webmPath: string): Promise<Uint8Array> => {
      converted.push(webmPath);
      return Promise.resolve(Buffer.from('GIF89a'));
    };
    await expect(video(file, webm, `see ${LEAKED_URI}`, convert)).rejects.toThrow(SecretError);
    expect(converted).toEqual([]);
    expect(existsSync(webm)).toBe(true);
    expect(snapshot(file)).toEqual(before);
  });

  it('exec refuses a language tag carrying a secret — without running the block', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const before = snapshot(file);
    await expect(exec(file, LEAKED_URI, 'touch ran', directory)).rejects.toThrow(SecretError);
    expect(existsSync(path.join(directory, 'ran'))).toBe(false);
    expect(snapshot(file)).toEqual(before);
  });

  describe('CLI', () => {
    const cli = fileURLToPath(new URL('cli.ts', import.meta.url));
    const run = (args: string[], cwd: string) =>
      spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd });

    it('exec refused for its OUTPUT exits 1 and prints nothing of the secret', async () => {
      const { file, directory } = tempDoc();
      await init(file, 'D');
      const before = snapshot(file);
      const result = run(['exec', file, 'bash', PRINT_LEAK], directory);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('refused to record command output');
      expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
      expect(snapshot(file)).toEqual(before);
    });

    it('init with a secret title exits 1 and writes nothing', () => {
      const { file, directory } = tempDoc();
      const result = run(['init', file, `Demo of ${LEAKED_URI}`], directory);
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
      expect(existsSync(file)).toBe(false);
    });

    it('image of a non-image text file is a usage error (exit 2) and copies nothing', async () => {
      const { file, directory } = tempDoc();
      await init(file, 'D');
      const source = path.join(directory, '.env.local');
      writeFileSync(source, `DB_URL=${LEAKED_URI}\n`);
      const before = snapshot(file);
      const result = run(['image', file, source], directory);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('not an image');
      expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
      expect(snapshot(file)).toEqual(before);
    });
  });

  it('shares the repo .secretlintrc.json, so its documented placeholder is recordable', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    const template =
      'postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres';
    await note(file, template);
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: template }]);
  });

  it('note still refuses a secret behind a secretlint-disable comment', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    const directive = ['secretlint', 'disable'].join('-');
    await expect(note(file, `<!-- ${directive} -->\n${LEAKED_URI}`)).rejects.toThrow(SecretError);
  });

  it('cannot be made to print the raw text by DEBUG=@secretlint/*', async () => {
    const { file } = tempDoc();
    await init(file, 'D');
    const cli = fileURLToPath(new URL('cli.ts', import.meta.url));
    const env = { ...process.env, DEBUG: '@secretlint/*,secretlint*' };
    const run = spawnSync('node', [cli, 'note', file, `connect with ${LEAKED_URI}`], {
      encoding: 'utf8',
      env,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refused to record');
    expect(`${run.stdout}${run.stderr}`).not.toContain(PASSWORD);
    expect(`${run.stdout}${run.stderr}`).not.toContain('executeOnContent');
  });

  it('leaves DEBUG as it found it, so exec children still inherit it', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    const saved = process.env['DEBUG'];
    process.env['DEBUG'] = 'app:*';
    try {
      await exec(file, 'bash', 'echo "debug=$DEBUG"', directory);
      expect(process.env['DEBUG']).toBe('app:*');
      expect(readFileSync(file, 'utf8')).toContain('debug=app:*');
    } finally {
      if (saved === undefined) delete process.env['DEBUG'];
      else process.env['DEBUG'] = saved;
    }
  });

  it('verify withholds a fresh output that carries a secret from its diff report', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    writeFileSync(path.join(directory, 'script.sh'), 'echo nothing yet\n');
    await exec(file, 'bash', 'sh script.sh', directory);
    writeFileSync(path.join(directory, 'script.sh'), `${PRINT_LEAK}\n`);
    const result = await verify(file, directory);
    expect(result.ok).toBe(false);
    expect(result.diffs[0]?.actual).toMatch(/^\[withheld: looks like a secret\]/);
    expect(result.diffs[0]?.actual).not.toContain(PASSWORD);
  });

  it('verify --output refuses to write a refreshed copy whose output now carries a secret', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'D');
    writeFileSync(path.join(directory, 'script.sh'), 'echo nothing yet\n');
    await exec(file, 'bash', 'sh script.sh', directory);
    writeFileSync(path.join(directory, 'script.sh'), `${PRINT_LEAK}\n`);
    const out = path.join(directory, 'refreshed.md');
    await expect(verify(file, directory, out)).rejects.toThrow(SecretError);
    expect(existsSync(out)).toBe(false);
  });
});

describe('extract', () => {
  it('emits showboat commands that recreate the doc', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'Title');
    await note(file, "it's fine");
    await exec(file, 'bash', 'echo hi', directory);
    expect(extract(file, 'copy.md').split('\n')).toEqual([
      "showboat init 'copy.md' 'Title'",
      String.raw`showboat note 'copy.md' 'it'\''s fine'`,
      "showboat exec 'copy.md' 'bash' 'echo hi'",
    ]);
  });

  it('includes image entries as showboat image commands', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'Title');
    const src = path.join(directory, 'shot.png');
    writeFileSync(src, PNG);
    await image(file, `![the caption](${src})`);
    const lines = extract(file, 'out.md').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("showboat init 'out.md' 'Title'");
    expect(lines[1]).toBe("showboat image 'out.md' '![the caption](demo-image-1.png)'");
  });

  it('falls back to bash when the exec lang is empty', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'Title');
    await exec(file, '', 'echo hi', directory);
    const lines = extract(file, 'out.md').split('\n');
    // lang should be 'bash' not ''
    expect(lines[1]).toBe("showboat exec 'out.md' 'bash' 'echo hi'");
  });

  it('preserves the actual lang when lang is not empty', async () => {
    const { file, directory } = tempDoc();
    await init(file, 'Title');
    await exec(file, 'node', 'console.log(1)', directory);
    const lines = extract(file, 'out.md').split('\n');
    expect(lines[1]).toBe("showboat exec 'out.md' 'node' 'console.log(1)'");
  });
});

describe('formatDemoLink', () => {
  const link = '📝 **Demo:** [docs/demos/x.md](/ac3charland/alfred/blob/main/docs/demos/x.md)';

  it('builds a github blob link from an SSH remote', () => {
    expect(formatDemoLink('git@github.com:ac3charland/alfred.git', 'main', 'docs/demos/x.md')).toBe(
      link,
    );
  });

  it('emits a root-relative href with no `https://` token (survives the MCP backtick-wrap)', () => {
    // The GitHub MCP PR-body writer double-backtick-wraps any `https://…` in the body, breaking the
    // link. A leading-slash href carries no such token, so it's posted verbatim and stays clickable.
    const out = formatDemoLink('git@github.com:o/r.git', 'main', 'docs/demos/x.md');
    expect(out).not.toContain('https://');
    expect(out).toContain('](/o/r/blob/main/docs/demos/x.md)');
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
      '📝 **Demo:** [docs/demos/x.md](/o/r/blob/claude/foo-bar/docs/demos/x.md)',
    );
  });

  it('normalizes a leading ./ and backslashes in the doc path', () => {
    expect(formatDemoLink('https://github.com/o/r', 'main', String.raw`./docs\demos\x.md`)).toBe(
      '📝 **Demo:** [docs/demos/x.md](/o/r/blob/main/docs/demos/x.md)',
    );
  });

  it('throws when owner/repo cannot be parsed from the remote', () => {
    expect(() => formatDemoLink('not-a-url', 'main', 'd.md')).toThrow(/owner\/repo/);
  });

  it('trims surrounding whitespace off the remote before parsing', () => {
    // Without .trim(), trailing whitespace defeats the `\.git$` strip and leaks into the repo name.
    expect(formatDemoLink('  git@github.com:o/r.git  ', 'main', 'docs/demos/x.md')).toBe(
      '📝 **Demo:** [docs/demos/x.md](/o/r/blob/main/docs/demos/x.md)',
    );
  });

  it('only strips a .git suffix at the very end of the remote (anchored)', () => {
    // The `$` anchor on `\.git$` matters: an unanchored `\.git` would chew a ".git" out of the
    // org name and leave the real ".git" suffix on the repo.
    expect(formatDemoLink('git@github.com:my.git-org/repo.git', 'main', 'docs/demos/x.md')).toBe(
      '📝 **Demo:** [docs/demos/x.md](/my.git-org/repo/blob/main/docs/demos/x.md)',
    );
  });

  it('drops empty path segments from a remote with a trailing slash', () => {
    // Without filter(Boolean), a trailing slash makes the last segment '' → repo is empty → throw.
    expect(formatDemoLink('git@github.com:o/r/', 'main', 'docs/demos/x.md')).toBe(
      '📝 **Demo:** [docs/demos/x.md](/o/r/blob/main/docs/demos/x.md)',
    );
  });

  it('trims surrounding whitespace off the doc path', () => {
    expect(formatDemoLink('https://github.com/o/r', 'main', '  docs/demos/x.md  ')).toBe(
      '📝 **Demo:** [docs/demos/x.md](/o/r/blob/main/docs/demos/x.md)',
    );
  });

  it('strips a run of leading slashes (with or without a leading dot) from the doc path', () => {
    // `^\.?\/+` must strip ALL leading slashes and tolerate a missing dot — a single-slash or
    // dot-required variant leaves a stray leading slash in the path.
    expect(formatDemoLink('https://github.com/o/r', 'main', '//docs/demos/x.md')).toBe(
      '📝 **Demo:** [docs/demos/x.md](/o/r/blob/main/docs/demos/x.md)',
    );
  });
});

describe('prLink', () => {
  it('formats the link from an injected git context (no real repo needed)', () => {
    expect(
      prLink('docs/demos/x.md', { remoteUrl: 'git@github.com:o/r.git', branch: 'feat/x' }),
    ).toBe('📝 **Demo:** [docs/demos/x.md](/o/r/blob/feat/x/docs/demos/x.md)');
  });
});
