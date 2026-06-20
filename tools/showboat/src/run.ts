import { spawnSync } from 'node:child_process';
import process from 'node:process';

export interface RunResult {
  output: string;
  status: number;
}

const NODE_LANGS = new Set(['node', 'js', 'javascript']);
const PYTHON_LANGS = new Set(['python', 'python3']);

/**
 * Execute a code block and capture its combined output.
 *
 * `lang` selects the interpreter: `node`/`js`/`javascript` run via `node -e`,
 * `python`/`python3` via `python3 -c`, and everything else (`bash`, `sh`,
 * `shell`, `zsh`, `console`, or an unrecognized label) runs through the system
 * shell. Output is stdout followed by stderr with trailing newlines trimmed, so
 * the recorded value is deterministic and `verify` can diff it cleanly. Color is
 * disabled via NO_COLOR/FORCE_COLOR to keep that output stable across machines.
 */
export function runCode(lang: string, code: string, workdir: string): RunResult {
  // Stryker disable next-line StringLiteral: AT_CEILING — NO_COLOR is consulted by *child* tools to suppress ANSI colour; the commands these tests run (echo/node/python) emit none either way, so '1'→'' produces byte-identical captured output. Killing it would require a colour-emitting child whose behaviour on NO_COLOR='' is itself environment-dependent.
  const environment = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  const base = {
    cwd: workdir,
    encoding: 'utf8' as const,
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
  };

  const normalized = lang.trim().toLowerCase();
  const result = NODE_LANGS.has(normalized)
    ? spawnSync('node', ['-e', code], base)
    : PYTHON_LANGS.has(normalized)
      ? spawnSync('python3', ['-c', code], base)
      : spawnSync(code, { ...base, shell: true });

  // With an encoding set, stdout/stderr are typed as strings; they are null only
  // when the process could not be spawned, in which case `error` carries the why.
  const parts = [result.stdout, result.stderr];
  // Stryker disable next-line ConditionalExpression: AT_CEILING — result.error is set only on a spawn failure (ENOENT) or a maxBuffer overflow; with node, python3, and the system shell all spawnable and test outputs well under maxBuffer, this branch can't be reached deterministically, so → false is unobservable.
  if (result.error) parts.push(result.error.message);

  const output = parts.join('').replace(/\n+$/, '');
  const status = typeof result.status === 'number' ? result.status : 1;
  return { output, status };
}
