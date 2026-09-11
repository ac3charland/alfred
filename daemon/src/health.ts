import type { DaemonConfig } from './config.ts';
import { HMAC_SECRET_SERVICE } from './keychain.ts';
import type { Logger } from './log.ts';
import type { Source } from './sources/types.ts';

/**
 * The startup checks, run on every launch (launchd restarts the daemon often) and on demand with
 * `--check`.
 *
 * They exist because the failures this daemon is exposed to are SILENT ones: a Full Disk Access
 * grant that reset across a macOS update, a keychain item that was never created, a config the
 * owner edited by hand. Each of those leaves a daemon that runs happily and ingests nothing — a
 * green dot over a dead source. A loud failure at start is the only thing that separates "quiet"
 * from "broken".
 */

export interface HealthCheck {
  name: string;
  ok: boolean;
  error?: string;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

export interface HealthDeps {
  loadConfig: () => DaemonConfig;
  readIngestSecret: () => Promise<string>;
  createSources: (config: DaemonConfig) => Source[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runHealthChecks(deps: HealthDeps): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  let config: DaemonConfig;
  try {
    config = deps.loadConfig();
    checks.push({ name: 'config', ok: true });
  } catch (error) {
    // Everything below reads the config, so there is nothing further to say.
    return { ok: false, checks: [{ name: 'config', ok: false, error: describe(error) }] };
  }

  const keychainCheck = `keychain: ${HMAC_SECRET_SERVICE}`;
  try {
    await deps.readIngestSecret();
    checks.push({ name: keychainCheck, ok: true });
  } catch (error) {
    // Not fatal to the rest of the run: one `--check` should report every problem at once.
    checks.push({ name: keychainCheck, ok: false, error: describe(error) });
  }

  const sources = deps.createSources(config);
  if (sources.length === 0) {
    checks.push({
      name: 'sources',
      ok: false,
      error: 'no source is enabled — nothing would be polled',
    });
  }

  for (const source of sources) {
    const name = `source: ${source.label}`;
    try {
      const result = await source.check();
      checks.push(result.ok ? { name, ok: true } : { name, ok: false, error: result.error });
    } catch (error) {
      checks.push({ name, ok: false, error: describe(error) });
    }
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/**
 * The failures that mean the daemon cannot run at all: an unreadable config, a missing HMAC
 * secret (nothing could be signed, so nothing could ever be delivered), or no enabled source.
 *
 * A failing SOURCE is deliberately not in that list. Its poll will fail too, and that failure is
 * carried to the server every minute as an erroring heartbeat — which is exactly how a revoked
 * Full Disk Access grant is meant to become visible. Exiting instead would take the daemon down
 * and leave the account looking merely stale, hiding the more precise answer behind the vaguer one.
 */
export function fatalFailures(report: HealthReport): HealthCheck[] {
  return report.checks.filter(
    (check) =>
      !check.ok &&
      (check.name === 'config' || check.name === 'sources' || check.name.startsWith('keychain:')),
  );
}

/** Prints the report — passes to stdout, failures to stderr so launchd's error log carries them. */
export function reportHealth(report: HealthReport, log: Logger): void {
  for (const check of report.checks) {
    if (check.ok) log.info(`health ok — ${check.name}`);
    else log.error(`health FAILED — ${check.name}: ${check.error ?? 'unknown error'}`);
  }
}
