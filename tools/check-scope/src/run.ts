import { spawnSync } from 'node:child_process';

/** What the CLI was asked to do: print help, or run a wrapped command. */
export type Invocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly command: string; readonly args: readonly string[] };

/** Arguments that ask for help rather than naming a command to wrap. */
const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h']);

/**
 * Split argv into the command to wrap and its arguments.
 *
 * **Only the first argument is ours.** Everything after it belongs to the wrapped
 * command and is forwarded verbatim — otherwise flags like `--if-present` (or the
 * wrapped command's own `--help`) would be swallowed here instead of reaching it.
 */
export function parseInvocation(argv: readonly string[]): Invocation {
  const first = argv[0];
  if (first === undefined || HELP_FLAGS.has(first)) return { kind: 'help' };
  return { kind: 'run', command: first, args: argv.slice(1) };
}

/** The subset of `spawnSync`'s result this module needs; injectable so tests stay hermetic. */
export interface SpawnResult {
  /** The child's exit code, or `undefined` when it died on a signal or never started. */
  readonly status: number | undefined;
  /** Set when the child could not be spawned at all (e.g. the binary is missing). */
  readonly error?: Error | undefined;
}

/** Runs a command to completion and reports how it ended. */
export type Spawner = (command: string, args: readonly string[]) => SpawnResult;

/**
 * Runs the command with the parent's stdio, so the wrapped suites print as they always did.
 * `spawnSync` reports a signal death as a `null` status; normalize it to `undefined` here so
 * that null never leaks past this boundary.
 */
const inheritStdio: Spawner = (command, args) => {
  const result = spawnSync(command, [...args], { stdio: 'inherit' });
  return { status: result.status ?? undefined, error: result.error };
};

/**
 * Run the wrapped command and return the exit code the CLI should exit with. A signal
 * death or a failed spawn reports 1 rather than 0: an unfinished gate must fail the
 * push, never pass it silently.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  spawn: Spawner = inheritStdio,
): number {
  const result = spawn(command, args);
  if (result.error !== undefined) return 1;
  return result.status ?? 1;
}
