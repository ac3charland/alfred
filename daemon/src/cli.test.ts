import { UsageError, parseArgs } from './cli.ts';

describe('parseArgs', () => {
  it('runs the poll loop with no flags', () => {
    expect(parseArgs([])).toEqual({ mode: 'loop', dryRun: false });
  });

  it('polls once and exits with --once', () => {
    expect(parseArgs(['--once'])).toEqual({ mode: 'once', dryRun: false });
  });

  it('prints instead of POSTing with --dry-run', () => {
    expect(parseArgs(['--once', '--dry-run'])).toEqual({ mode: 'once', dryRun: true });
  });

  it('runs only the startup health checks with --check', () => {
    expect(parseArgs(['--check'])).toEqual({ mode: 'check', dryRun: false });
  });

  it('restricts to one source with --source', () => {
    expect(parseArgs(['--source', 'workmail'])).toEqual({
      mode: 'loop',
      dryRun: false,
      sources: ['workmail'],
    });
  });

  it('accepts --source twice', () => {
    expect(parseArgs(['--source', 'workmail', '--source', 'imessage']).sources).toEqual([
      'workmail',
      'imessage',
    ]);
  });

  it('shows help for --help and -h', () => {
    expect(parseArgs(['--help']).mode).toBe('help');
    expect(parseArgs(['-h']).mode).toBe('help');
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--verbose'])).toThrow(UsageError);
    expect(() => parseArgs(['--verbose'])).toThrow('unknown option "--verbose"');
  });

  it('rejects a source the daemon does not run', () => {
    expect(() => parseArgs(['--source', 'gmail'])).toThrow(
      'unknown source "gmail" — the daemon polls "imessage" and "workmail"',
    );
  });

  it('rejects --source with no value', () => {
    expect(() => parseArgs(['--source'])).toThrow('--source needs a source name');
  });

  it('rejects a bare argument', () => {
    expect(() => parseArgs(['once'])).toThrow('unexpected argument "once"');
  });
});
