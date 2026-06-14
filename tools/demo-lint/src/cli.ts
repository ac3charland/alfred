import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { changedPathsSinceTrunk, currentBranch, gatherDemos } from './demos.ts';
import { countBySeverity, lintDemos } from './lint.ts';

const HELP = `demo-lint — enforce the docs/demos folder-per-demo structure.

Usage:
  demo-lint [dir]   Lint a demos directory. With no argument, lints docs/demos
                    at the repo root.

Options:
  --branch <name>   Treat <name> as the current branch (default: git HEAD). Use it
                    to check what a given branch owes without switching branches.
  --help, -h        Show this help.

Rules:
  ✗ no-root-files  — only README.md may sit directly in docs/demos/; every demo
                     lives in its own folder.
  ✗ branch-folder  — a feature branch must own a demo; a doc claims a branch via
                     "branch: <name>" in its YAML front matter (folder name is free).
                     A docs-only branch (every change under docs/) is exempt.

In this repo, run it through the package script: npm run lint:demos -w tools/demo-lint
`;

/** A usage problem the caller should fix; reported to stderr with exit code 2. */
class UsageError extends Error {}

// src/cli.ts → repo root is three levels up, then into the demos directory.
const DEFAULT_DEMOS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/demos',
);

function main(argv: readonly string[]): number {
  const inputs: string[] = [];
  let branch: string | undefined;
  let branchOverridden = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    if (arg === '--branch') {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError('--branch requires a value.');
      branch = value;
      branchOverridden = true;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new UsageError(`unknown option "${arg}". Run "demo-lint --help".`);
    }
    inputs.push(arg);
  }
  if (inputs.length > 1) {
    throw new UsageError('expected at most one demos directory.');
  }

  const cwd = process.cwd();
  const demosDir = inputs[0] === undefined ? DEFAULT_DEMOS_DIR : path.resolve(cwd, inputs[0]);
  if (!existsSync(demosDir)) {
    throw new UsageError(`demos directory not found: ${demosDir}`);
  }

  // The diff always runs against the real HEAD, even when --branch is overridden.
  const demos = gatherDemos(
    demosDir,
    cwd,
    branchOverridden ? branch : currentBranch(),
    changedPathsSinceTrunk(),
  );
  const findings = lintDemos(demos);

  if (findings.length > 0) {
    process.stdout.write(`\n${demos.displayPath}\n`);
    for (const finding of findings) {
      const icon = finding.severity === 'error' ? '✗' : '⚠';
      process.stdout.write(`  ${icon} ${finding.severity} [${finding.rule}] ${finding.message}\n`);
    }
  }

  const { errors, warnings } = countBySeverity(findings);
  process.stdout.write(
    `\ndemo-lint: ${String(errors)} error(s), ${String(warnings)} warning(s).\n`,
  );
  return errors > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`demo-lint: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
