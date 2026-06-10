import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exec, extract, image, init, note, pop, verify } from './commands.ts';
import { parseDocument } from './document.ts';

function tempDoc(): { file: string; directory: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'showboat-'));
  return { file: path.join(directory, 'demo.md'), directory };
}

function entriesOf(file: string) {
  return parseDocument(readFileSync(file, 'utf8')).entries;
}

describe('init', () => {
  it('writes the title and an ISO-8601 timestamp', () => {
    const { file } = tempDoc();
    init(file, 'My Demo', new Date('2026-06-10T12:00:00.000Z'));
    const document = parseDocument(readFileSync(file, 'utf8'));
    expect(document.title).toBe('My Demo');
    expect(document.timestamp).toBe('2026-06-10T12:00:00.000Z');
    expect(document.entries).toEqual([]);
  });
});

describe('note', () => {
  it('appends a commentary entry', () => {
    const { file } = tempDoc();
    init(file, 'D');
    note(file, 'hello world');
    expect(entriesOf(file)).toEqual([{ kind: 'note', text: 'hello world' }]);
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
});
