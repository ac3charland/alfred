import { parseInvocation, runCommand } from './run.ts';

describe('parseInvocation', () => {
  it('asks for help when given no command', () => {
    expect(parseInvocation([])).toEqual({ kind: 'help' });
  });

  it('asks for help on --help or -h in the first position', () => {
    expect(parseInvocation(['--help'])).toEqual({ kind: 'help' });
    expect(parseInvocation(['-h'])).toEqual({ kind: 'help' });
  });

  it('takes the first argument as the command and the rest as its arguments', () => {
    expect(parseInvocation(['npm', 'run', 'check:slow'])).toEqual({
      kind: 'run',
      command: 'npm',
      args: ['run', 'check:slow'],
    });
  });

  it('passes the wrapped command flags through verbatim', () => {
    // Only the FIRST argument is ours; everything after belongs to the wrapped
    // command, so its own --help / --if-present flags are never intercepted.
    expect(parseInvocation(['npm', 'run', 'check:slow', '--workspaces', '--if-present'])).toEqual({
      kind: 'run',
      command: 'npm',
      args: ['run', 'check:slow', '--workspaces', '--if-present'],
    });
    expect(parseInvocation(['npm', '--help'])).toEqual({
      kind: 'run',
      command: 'npm',
      args: ['--help'],
    });
  });
});

describe('runCommand', () => {
  it('runs the command with its arguments and passes a success through', () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawn = (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0 };
    };
    expect(runCommand('npm', ['run', 'check:slow'], spawn)).toBe(0);
    expect(calls).toEqual([{ command: 'npm', args: ['run', 'check:slow'] }]);
  });

  it('propagates a failing exit code so the gate still fails the push', () => {
    expect(runCommand('npm', [], () => ({ status: 3 }))).toBe(3);
  });

  it('fails when the command died on a signal', () => {
    // No exit code at all — an unfinished gate must fail the push, not pass it.
    expect(runCommand('npm', [], () => ({ status: undefined }))).toBe(1);
  });

  it('fails when the command could not be spawned at all', () => {
    expect(runCommand('nope', [], () => ({ status: undefined, error: new Error('ENOENT') }))).toBe(
      1,
    );
  });
});
