import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCode } from './run.ts';

function workdir(): string {
  return mkdtempSync(path.join(tmpdir(), 'showboat-run-'));
}

describe('runCode', () => {
  it('runs the "js" alias through node', () => {
    expect(runCode('js', 'console.log(1 + 1)', workdir())).toEqual({ output: '2', status: 0 });
  });

  it('runs the "javascript" alias through node', () => {
    expect(runCode('javascript', 'console.log(3 * 3)', workdir())).toEqual({
      output: '9',
      status: 0,
    });
  });

  it('runs the "python" alias through python3', () => {
    expect(runCode('python', 'print(2 + 2)', workdir())).toEqual({ output: '4', status: 0 });
  });

  it('runs the "python3" alias through python3', () => {
    expect(runCode('python3', 'print(5 + 5)', workdir())).toEqual({ output: '10', status: 0 });
  });

  it('normalizes the language label by trimming and lowercasing it', () => {
    // '  NODE  ' must resolve to the node interpreter — a missing trim()/toLowerCase() would route
    // it to the shell and run "console.log(7)" as a (failing) command instead.
    expect(runCode('  NODE  ', 'console.log(7)', workdir())).toEqual({ output: '7', status: 0 });
  });

  it('captures output larger than a few dozen bytes (maxBuffer is megabytes, not bytes)', () => {
    // A shrunk maxBuffer (e.g. 64*1024/1024 = 64 bytes) would truncate or error on this.
    const result = runCode('bash', 'printf "%0200d" 0', workdir());
    expect(result.status).toBe(0);
    expect(result.output).toHaveLength(200);
  });

  it('strips ALL trailing newlines but preserves interior ones', () => {
    // `printf 'a\nb\n\n'` → captured "a\nb\n\n". `/\n+$/` collapses the trailing run to nothing
    // while keeping the interior newline; `/\n+/` (no anchor) or `/\n$/` (single) would not.
    const result = runCode('bash', String.raw`printf 'a\nb\n\n'`, workdir());
    expect(result.output).toBe('a\nb');
  });

  it('reports status 1 when the process is killed by a signal (status is null)', () => {
    // A signal kill leaves spawnSync's status === null; the `typeof status === 'number'` guard
    // must coerce that to 1 rather than passing null through.
    const result = runCode('bash', 'kill -9 $$', workdir());
    expect(result.status).toBe(1);
  });
});
