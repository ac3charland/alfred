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
  if (result.error) parts.push(result.error.message);

  const output = parts.join('').replace(/\n+$/, '');
  const status = typeof result.status === 'number' ? result.status : 1;
  return { output, status };
}
