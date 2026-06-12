import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { countBySeverity, lintSkills } from './lint.ts';
import { parseSkill, resolveSkillMdPaths } from './skill.ts';

const HELP = `skill-lint — lint .claude/skills SKILL.md files against the authoring guidance.

Usage:
  skill-lint [path-or-glob ...]   Lint the given SKILL.md files, skill directories,
                                  or globs. With no arguments, lints every skill in
                                  .claude/skills/.

Examples:
  skill-lint                                # all skills
  skill-lint .claude/skills/showboat        # one skill (by directory)
  skill-lint '.claude/skills/*/SKILL.md'    # an explicit glob (quote it)

Options:
  --help, -h    Show this help.

Findings:
  ✗ error  — fails the lint (exit 1); fix it in the skill.
  ⚠ warn   — advisory; does not fail the lint.

In this repo, run it through the package script: npm run lint:skills -w tools/skill-lint
`;

/** A usage problem the caller should fix; reported to stderr with exit code 2. */
class UsageError extends Error {}

// src/cli.ts → repo root is three levels up, then into the skills library.
const DEFAULT_SKILLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.claude/skills',
);

function main(argv: readonly string[]): number {
  const inputs: string[] = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    if (arg.startsWith('-')) {
      throw new UsageError(`unknown option "${arg}". Run "skill-lint --help".`);
    }
    inputs.push(arg);
  }

  const cwd = process.cwd();
  const skillMdPaths = resolveSkillMdPaths(inputs, cwd, DEFAULT_SKILLS_DIR);
  if (skillMdPaths.length === 0) {
    if (inputs.length > 0) {
      throw new UsageError(`no SKILL.md files matched: ${inputs.join(', ')}`);
    }
    process.stdout.write('skill-lint: no skills found.\n');
    return 0;
  }

  const reports = lintSkills(skillMdPaths.map((skillMdPath) => parseSkill(skillMdPath, cwd)));
  for (const report of reports) {
    if (report.findings.length === 0) continue;
    process.stdout.write(`\n${report.skill.displayPath}\n`);
    for (const finding of report.findings) {
      const icon = finding.severity === 'error' ? '✗' : '⚠';
      const location = finding.line === undefined ? '' : `:${String(finding.line)}`;
      process.stdout.write(
        `  ${icon} ${finding.severity} [${finding.rule}]${location} ${finding.message}\n`,
      );
    }
  }

  const { errors, warnings } = countBySeverity(reports);
  process.stdout.write(
    `\nskill-lint: ${String(reports.length)} skill(s), ${String(errors)} error(s), ${String(warnings)} warning(s).\n`,
  );
  return errors > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`skill-lint: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
