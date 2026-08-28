import process from 'node:process';

import { changedPathsSinceTrunk } from './git.ts';
import { parseInvocation, runCommand } from './run.ts';
import { decideScope } from './scope.ts';

const HELP = `check-scope — run a command only when the branch changes code.

Usage:
  check-scope <command> [args...]   Run <command> unless every change on this branch
                                    (vs the trunk merge-base) lives under docs/.

Only the FIRST argument is read as the command; everything after it is forwarded
verbatim, so the wrapped command keeps its own flags.

Environment:
  CHECK_SCOPE_ALL=1   Run the command unconditionally (the escape hatch — use it to
                      get the full tier on a docs-only branch).

Uncertainty always runs the command: an unknown diff (no git, no trunk ref, a shallow
checkout) or an empty one never counts as docs-only.

In this repo it wraps the check:slow fan-out from the root package.json, so a spec- or
demo-only push skips the Storybook, Playwright, and database suites it cannot break.
`;

function main(argv: readonly string[]): number {
  const invocation = parseInvocation(argv);
  if (invocation.kind === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const forceAll = (process.env['CHECK_SCOPE_ALL'] ?? '').length > 0;
  const decision = decideScope(changedPathsSinceTrunk(), forceAll);
  const commandLine = [invocation.command, ...invocation.args].join(' ');
  process.stdout.write(`check-scope: ${decision.reason}\n`);
  if (!decision.run) {
    process.stdout.write(
      `check-scope: skipped "${commandLine}" — set CHECK_SCOPE_ALL=1 to run it anyway.\n`,
    );
    return 0;
  }
  return runCommand(invocation.command, invocation.args);
}

process.exitCode = main(process.argv.slice(2));
