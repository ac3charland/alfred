import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { countBySeverity, lintMigrations } from './lint.ts';
import { DEFAULT_MIGRATIONS_DIR, gatherMigrations } from './migrations.ts';

const HELP = `migration-lint — statically lint the database/migrations SQL files.

Usage:
  migration-lint [dir]   Lint a migrations directory. With no argument, lints
                         database/migrations at the repo root. Every migration is
                         always linted (there is no changed-only mode).

Options:
  --help, -h        Show this help.

Rules:
  ✗ sequence-grant — every sequence a migration creates must grant USAGE to anon,
                     authenticated, and service_role. The insert RPCs are security
                     invoker, so a column default's nextval('<seq>') runs as the
                     calling role, which needs USAGE on the sequence or the insert
                     500s with "permission denied for sequence".

In this repo, run it through the package script: npm run lint:migrations -w tools/migration-lint
`;

/** A usage problem the caller should fix; reported to stderr with exit code 2. */
class UsageError extends Error {}

function main(argv: readonly string[]): number {
  const inputs: string[] = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    if (arg.startsWith('-')) {
      throw new UsageError(`unknown option "${arg}". Run "migration-lint --help".`);
    }
    inputs.push(arg);
  }
  if (inputs.length > 1) {
    throw new UsageError('expected at most one migrations directory.');
  }

  const cwd = process.cwd();
  const migrationsDir =
    inputs[0] === undefined ? DEFAULT_MIGRATIONS_DIR : path.resolve(cwd, inputs[0]);
  if (!existsSync(migrationsDir)) {
    throw new UsageError(`migrations directory not found: ${migrationsDir}`);
  }

  const migrations = gatherMigrations(migrationsDir, cwd);
  const findings = lintMigrations(migrations);

  if (findings.length > 0) {
    process.stdout.write(`\n${migrations.displayPath}\n`);
    for (const finding of findings) {
      const icon = finding.severity === 'error' ? '✗' : '⚠';
      process.stdout.write(`  ${icon} ${finding.severity} [${finding.rule}] ${finding.message}\n`);
    }
  }

  const { errors, warnings } = countBySeverity(findings);
  process.stdout.write(
    `\nmigration-lint: ${String(errors)} error(s), ${String(warnings)} warning(s).\n`,
  );
  return errors > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`migration-lint: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
