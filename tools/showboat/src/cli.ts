import { readFileSync } from 'node:fs';
import process from 'node:process';

import {
  type VerifyResult,
  exec,
  extract,
  image,
  init,
  note,
  pop,
  prLink,
  verify,
} from './commands.ts';

const VERSION = '0.1.0';

const HELP = `showboat — build executable demo docs that prove a change works.

Usage:
  showboat init <file> <title>             Create a new demo doc.
  showboat note <file> [text]              Append commentary (stdin if omitted).
  showboat exec <file> <lang> [code]       Run code, capture output (stdin if omitted).
  showboat image <file> <path|markdown>    Embed an image next to the doc.
  showboat pop <file>                      Remove the most recent entry.
  showboat verify <file> [--output <f>]    Re-run every exec block, diff the output.
  showboat extract <file> [--filename <f>] Print the commands that recreate the doc.
  showboat pr-link <file>                  Print the live PR demo-doc link (Markdown).

Global options:
  --workdir <dir>   Directory to run code blocks in (default: cwd).
  --version         Print the version.
  --help, -h        Show this help.

In this repo, run it through the root script: npm run demo -- <command> ...
`;

/** A usage problem the caller should fix; reported to stderr with exit code 2. */
class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/** Pull a `--name value` flag out of `args`, returning its value and the remainder. */
function takeOption(args: readonly string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      value = args[i + 1] ?? fail(`${name} requires a value`);
      i += 1;
    } else {
      rest.push(args[i] ?? '');
    }
  }
  return value === undefined ? { rest } : { value, rest };
}

function reportVerify(file: string, result: VerifyResult): void {
  for (const diff of result.diffs) {
    process.stdout.write(
      `\n✗ exec #${String(diff.index)} (${diff.lang || 'shell'}) output changed:\n` +
        `  $ ${diff.code}\n` +
        `  --- recorded\n${indent(diff.expected)}\n` +
        `  +++ actual\n${indent(diff.actual)}\n`,
    );
  }
  process.stdout.write(
    result.ok
      ? `✓ ${file}: all ${String(result.checked)} exec block(s) match.\n`
      : `\n${String(result.diffs.length)} of ${String(result.checked)} exec block(s) in ${file} changed.\n`,
  );
}

function main(argv: readonly string[]): number {
  let workdir = process.cwd();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    switch (arg) {
      case '--workdir': {
        workdir = argv[i + 1] ?? fail('--workdir requires a value');
        i += 1;

        break;
      }
      case '--version': {
        process.stdout.write(`${VERSION}\n`);
        return 0;
      }
      case '--help':
      case '-h': {
        process.stdout.write(HELP);
        return 0;
      }
      default: {
        positional.push(arg);
      }
    }
  }

  const [command, ...rest] = positional;
  switch (command) {
    case undefined:
    case 'help': {
      process.stdout.write(HELP);
      return 0;
    }
    case 'init': {
      const [file, ...titleParts] = rest;
      const title = titleParts.join(' ').trim();
      if (!file || !title) fail('usage: showboat init <file> <title>');
      init(file, title);
      return 0;
    }
    case 'note': {
      const [file, ...textParts] = rest;
      if (!file) fail('usage: showboat note <file> [text]');
      note(file, textParts.length > 0 ? textParts.join(' ') : readStdin());
      return 0;
    }
    case 'exec': {
      const [file, lang, ...codeParts] = rest;
      if (!file || !lang) fail('usage: showboat exec <file> <lang> [code]');
      const code = codeParts.length > 0 ? codeParts.join(' ') : readStdin();
      const result = exec(file, lang, code, workdir);
      if (result.output.length > 0) process.stdout.write(`${result.output}\n`);
      return result.status;
    }
    case 'image': {
      const [file, ...imageParts] = rest;
      const argument = imageParts.join(' ');
      if (!file || !argument) fail('usage: showboat image <file> <path|markdown>');
      image(file, argument);
      return 0;
    }
    case 'pop': {
      const [file] = rest;
      if (!file) fail('usage: showboat pop <file>');
      pop(file);
      return 0;
    }
    case 'verify': {
      const { value: outputFile, rest: positional2 } = takeOption(rest, '--output');
      const [file] = positional2;
      if (!file) fail('usage: showboat verify <file> [--output <file>]');
      const result = verify(file, workdir, outputFile);
      reportVerify(file, result);
      return result.ok ? 0 : 1;
    }
    case 'extract': {
      const { value: filename, rest: positional2 } = takeOption(rest, '--filename');
      const [file] = positional2;
      if (!file) fail('usage: showboat extract <file> [--filename <name>]');
      process.stdout.write(`${extract(file, filename)}\n`);
      return 0;
    }
    case 'pr-link': {
      const [file] = rest;
      if (!file) fail('usage: showboat pr-link <file>');
      process.stdout.write(`${prLink(file)}\n`);
      return 0;
    }
    default: {
      return fail(`unknown command "${command}". Run "showboat --help".`);
    }
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`showboat: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
