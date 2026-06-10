import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type Entry, type ShowboatDocument, parseDocument, serializeDocument } from './document.ts';
import { type RunResult, runCode } from './run.ts';

const IMAGE_MARKDOWN = /^!\[([^\]]*)\]\(([^)]*)\)$/;

function load(file: string): ShowboatDocument {
  return parseDocument(readFileSync(file, 'utf8'));
}

function save(file: string, document: ShowboatDocument): void {
  writeFileSync(file, serializeDocument(document));
}

/** Create a fresh demo doc with a title and an ISO-8601 timestamp. */
export function init(file: string, title: string, now: Date = new Date()): void {
  save(file, { title, timestamp: now.toISOString(), entries: [] });
}

/** Append a commentary paragraph. */
export function note(file: string, text: string): void {
  const document = load(file);
  document.entries.push({ kind: 'note', text: text.replace(/\n+$/, '') });
  save(file, document);
}

/**
 * Run a code block, append it (with captured output) to the doc, and return the
 * captured output plus the child's exit code so the CLI can echo the output and
 * exit with the same status — surfacing failures the same way running the
 * command directly would.
 */
export function exec(file: string, lang: string, code: string, workdir: string): RunResult {
  const document = load(file);
  const result = runCode(lang, code, workdir);
  document.entries.push({
    kind: 'exec',
    lang,
    code: code.replace(/\n+$/, ''),
    output: result.output,
  });
  save(file, document);
  return result;
}

/**
 * Embed an image. Accepts either a bare path or a full `![alt](path)`. The source
 * file is copied next to the doc under a generated, collision-free name.
 */
export function image(file: string, argument: string): void {
  const document = load(file);
  const markdown = IMAGE_MARKDOWN.exec(argument.trim());
  const alt = markdown ? (markdown[1] ?? '') : '';
  const source = markdown ? (markdown[2] ?? '') : argument;

  const documentDirectory = path.dirname(path.resolve(file));
  const extension = path.extname(source) || '.png';
  const stem = path.basename(file, path.extname(file));
  const imageCount = document.entries.filter((entry) => entry.kind === 'image').length;
  const generated = `${stem}-image-${String(imageCount + 1)}${extension}`;

  copyFileSync(source, path.join(documentDirectory, generated));
  document.entries.push({ kind: 'image', alt, path: generated });
  save(file, document);
}

/** Remove and return the most recent entry (an exec drops its code *and* output). */
export function pop(file: string): Entry | undefined {
  const document = load(file);
  const removed = document.entries.pop();
  save(file, document);
  return removed;
}

export interface VerifyDiff {
  index: number;
  lang: string;
  code: string;
  expected: string;
  actual: string;
}

export interface VerifyResult {
  ok: boolean;
  diffs: VerifyDiff[];
  /** Total exec blocks that were re-run (image/note entries are skipped). */
  checked: number;
}

/**
 * Re-run every exec block and diff the fresh output against what was recorded.
 * `outputFile`, when given, writes a copy of the doc with refreshed outputs.
 */
export function verify(file: string, workdir: string, outputFile?: string): VerifyResult {
  const document = load(file);
  const diffs: VerifyDiff[] = [];
  let checked = 0;

  const entries = document.entries.map((entry): Entry => {
    if (entry.kind !== 'exec') return entry;
    checked += 1;
    const result = runCode(entry.lang, entry.code, workdir);
    if (result.output !== entry.output) {
      diffs.push({
        index: checked,
        lang: entry.lang,
        code: entry.code,
        expected: entry.output,
        actual: result.output,
      });
    }
    return { ...entry, output: result.output };
  });

  if (outputFile !== undefined) save(outputFile, { ...document, entries });
  return { ok: diffs.length === 0, diffs, checked };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** Emit the sequence of showboat commands that would recreate the doc. */
export function extract(file: string, filename?: string): string {
  const document = load(file);
  const target = filename ?? file;
  const lines = [`showboat init ${shellQuote(target)} ${shellQuote(document.title)}`];
  for (const entry of document.entries) {
    switch (entry.kind) {
      case 'note': {
        lines.push(`showboat note ${shellQuote(target)} ${shellQuote(entry.text)}`);
        break;
      }
      case 'exec': {
        const lang = entry.lang || 'bash';
        lines.push(
          `showboat exec ${shellQuote(target)} ${shellQuote(lang)} ${shellQuote(entry.code)}`,
        );
        break;
      }
      case 'image': {
        lines.push(
          `showboat image ${shellQuote(target)} ${shellQuote(`![${entry.alt}](${entry.path})`)}`,
        );
        break;
      }
    }
  }
  return lines.join('\n');
}
