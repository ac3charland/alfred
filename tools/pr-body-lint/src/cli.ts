import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { lintPrBody } from './lint.ts';

const HELP = `pr-body-lint — lint a pull request description.

Usage:
  pr-body-lint [file]   Lint the PR body in <file>, or read it from stdin.
  --help, -h            Show this help.

Rule:
  ✗ double-backticked-url — a URL wrapped in double backticks renders as inline code, not a
                            link: a link target, [text](\`\`https://…\`\`) or [text](\`\`/o/r/…\`\`),
                            or a bare \`\`https://…\`\`. Write the plain URL: [text](https://…).
                            Fenced code blocks are not checked.

In this repo, the PR body workflow runs it: npm run lint:pr-body -w tools/pr-body-lint -- <file>
`;

/** A usage problem the caller should fix; reported to stderr with exit code 2. */
class UsageError extends Error {}

function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const unknown = argv.find((arg) => arg.startsWith('-'));
  if (unknown !== undefined) {
    throw new UsageError(`unknown option "${unknown}". Run "pr-body-lint --help".`);
  }
  if (argv.length > 1) throw new UsageError('expected at most one file.');

  let body: string;
  const input = argv[0];
  if (input === undefined) {
    body = readFileSync(0, 'utf8');
  } else {
    // npm run -w runs in the package directory; resolve against where npm was invoked.
    const file = path.resolve(process.env['INIT_CWD'] ?? process.cwd(), input);
    if (!existsSync(file)) throw new UsageError(`file not found: ${file}`);
    body = readFileSync(file, 'utf8');
  }

  const findings = lintPrBody(body);
  for (const { line, url } of findings) {
    process.stdout.write(
      `  ✗ error [double-backticked-url] line ${String(line)}: ${url} is wrapped in double backticks, so it renders as code, not a link. Remove the backticks.\n`,
    );
  }
  process.stdout.write(`\npr-body-lint: ${String(findings.length)} error(s).\n`);
  return findings.length > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`pr-body-lint: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
