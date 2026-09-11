import type { SourceKey } from './contract.ts';

/** Argument parsing for the daemon entry point. Pure: it reads a vector and returns intent. */

export class UsageError extends Error {
  override name = 'UsageError';
}

export type CliMode = 'loop' | 'once' | 'check' | 'help';

export interface CliOptions {
  mode: CliMode;
  /** Poll and print normalized messages as JSON to stdout. Never POSTs, never advances anything. */
  dryRun: boolean;
  /** When present, only these sources run. */
  sources?: SourceKey[];
}

const KNOWN_SOURCES: ReadonlySet<SourceKey> = new Set(['imessage', 'workmail']);

export const HELP = `alfred comms daemon — polls this Mac's messages and ships them to alfred.

Usage:
  daemon [options]

Options:
  --once             Poll every enabled source once, then exit.
  --dry-run          Print normalized messages as JSON instead of POSTing them.
  --source <key>     Only run this source (imessage | workmail). Repeatable.
  --check            Run the startup health checks and exit 0 (healthy) or 1 (not).
  --help, -h         Show this help.

With no options it polls every enabled source forever.

Configuration lives at ~/Library/Application Support/alfred-daemon/config.json (override with
ALFRED_DAEMON_CONFIG). Secrets live in the macOS keychain — never in the config, never here.
`;

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { mode: 'loop', dryRun: false };
  const sources: SourceKey[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--help':
      case '-h': {
        return { mode: 'help', dryRun: false };
      }
      case '--once': {
        options.mode = 'once';
        break;
      }
      case '--check': {
        options.mode = 'check';
        break;
      }
      case '--dry-run': {
        options.dryRun = true;
        break;
      }
      case '--source': {
        index += 1;
        const value = argv[index];
        if (value === undefined) throw new UsageError('--source needs a source name');
        if (!KNOWN_SOURCES.has(value as SourceKey)) {
          throw new UsageError(
            `unknown source "${value}" — the daemon polls "imessage" and "workmail"`,
          );
        }
        sources.push(value as SourceKey);
        break;
      }
      default: {
        if (argument?.startsWith('-') === true) {
          throw new UsageError(`unknown option "${argument}"`);
        }
        throw new UsageError(`unexpected argument "${String(argument)}"`);
      }
    }
  }

  if (sources.length > 0) options.sources = sources;
  return options;
}
