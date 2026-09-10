import { execFile as execFileCallback } from 'node:child_process';
import { homedir } from 'node:os';
import process from 'node:process';
import { promisify } from 'node:util';

import { HELP, UsageError, parseArgs } from './cli.ts';
import type { CliOptions } from './cli.ts';
import { configPathFrom, loadConfig, stateFilePathFor } from './config.ts';
import type { DaemonConfig } from './config.ts';
import { runLoop, runOnce } from './daemon.ts';
import { fatalFailures, reportHealth, runHealthChecks } from './health.ts';
import { createHeartbeatSchedule } from './heartbeat.ts';
import { createIngestClient } from './ingest-client.ts';
import type { FetchLike } from './ingest-client.ts';
import { createKeychain, createSecretResolver } from './keychain.ts';
import { createLogger } from './log.ts';
import { createSourceRunner } from './runner.ts';
import type { SourceRunner } from './runner.ts';
import { createSources } from './sources/index.ts';
import { readState, writeState } from './state.ts';

/**
 * The daemon's entry point, and its only composition root: every module below this file takes its
 * collaborators as parameters, which is why all of them are testable without a Mac, a keychain, a
 * network, or a chat.db.
 *
 * What this process is: a dumb pipe. It polls the owner's own machine, normalizes what it finds,
 * and POSTs it HMAC-signed to alfred's ingest endpoint. It holds no Anthropic key and no Supabase
 * credential — triage happens server-side — so the most a lost laptop gives away is the ability to
 * write messages into one inbox.
 */

const execFile = promisify(execFileCallback);
const log = createLogger();

/** `globalThis.fetch`, narrowed to the two things the ingest client uses. */
const httpFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

function buildRunners(
  config: DaemonConfig,
  options: CliOptions,
  configPath: string,
  secret: string,
): SourceRunner[] {
  const keychain = createKeychain((file, arguments_) => execFile(file, [...arguments_]));
  const ingest = createIngestClient({
    ingestUrl: config.ingestUrl,
    secret,
    fetch: httpFetch,
    log,
  });
  const secrets = createSecretResolver(keychain, config);
  const heartbeats = createHeartbeatSchedule();
  const statePath = stateFilePathFor(configPath);
  const state = readState(statePath);

  return createSources(config, options.sources).map((source) => {
    const cached = state[source.key];
    return createSourceRunner({
      source,
      secrets,
      send: (payload) => ingest.send(payload),
      heartbeats,
      log,
      print: (line) => void process.stdout.write(`${line}\n`),
      dryRun: options.dryRun,
      ...(cached === undefined ? {} : { initial: cached }),
      persist: (next) => {
        state[source.key] = next;
        writeState(statePath, state);
      },
    });
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.mode === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const configPath = configPathFrom(process.env, homedir());
  const keychain = createKeychain((file, arguments_) => execFile(file, [...arguments_]));

  // Run on every start, because launchd restarts this process often and the failures that matter
  // here are silent ones — a Full Disk Access grant that reset across a macOS update, a keychain
  // item that was never created, a config edited by hand.
  const report = await runHealthChecks({
    loadConfig: () => loadConfig(configPath),
    readIngestSecret: () => keychain.readIngestSecret(),
    createSources: (config) => createSources(config, options.sources),
  });
  reportHealth(report, log);

  if (options.mode === 'check') return report.ok ? 0 : 1;

  const fatal = fatalFailures(report);
  if (fatal.length > 0) {
    log.error('cannot start', { failures: fatal.map((check) => check.name) });
    return 1;
  }

  const config = loadConfig(configPath);
  const secret = await keychain.readIngestSecret();
  const runners = buildRunners(config, options, configPath, secret);
  log.info('starting', {
    sources: runners.map((runner) => runner.key),
    mode: options.mode,
    dryRun: options.dryRun,
  });

  if (options.mode === 'once') {
    await runOnce(runners, new Date(), log);
    return 0;
  }

  let running = true;
  const stop = (signal: string): void => {
    log.info('stopping', { signal });
    running = false;
  };
  process.on('SIGINT', () => {
    stop('SIGINT');
  });
  process.on('SIGTERM', () => {
    stop('SIGTERM');
  });

  await runLoop({ runners, log, shouldContinue: () => running });
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`daemon: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    log.error('fatal', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
