import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { createEngine } from '@secretlint/node';

import { knownSecrets, knownSecretsReport, repoEnvRoots } from './known-secrets.ts';

const CONFIG_NAME = '.secretlintrc.json';

/**
 * The repo's single secretlint config — the same file `tools/secret-scan` (the commit gate)
 * reads, so the record-time guard and the gate can never disagree about what a secret is. Found by
 * walking up from `startDir`, not by a fixed `../../..`, because Stryker runs this module from a
 * sandbox copy a few directories deeper. No config anywhere above is an error (fail closed): the
 * guard must never quietly run with no rules.
 */
export function findConfigFile(startDir: string): string {
  for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(`${CONFIG_NAME} not found in ${startDir} or any parent directory`);
}

type Engine = Awaited<ReturnType<typeof createEngine>>;

let config: string | undefined;
let envRoots: string[] | undefined;
let engine: Promise<Engine> | undefined;

/**
 * Build the secretlint engine with `DEBUG` unset. secretlint logs through the `debug` module, which
 * reads `DEBUG` once as it loads and — with `DEBUG=@secretlint/*` — prints every scanned text's raw
 * content, secrets included. Loading it (and the rules `createEngine` imports) with the variable
 * removed leaves that logging off; the variable goes straight back, since `exec` children inherit it.
 */
async function loadEngine(configFile: string): Promise<Engine> {
  const debug = process.env['DEBUG'];
  delete process.env['DEBUG'];
  try {
    const { createEngine: create } = await import('@secretlint/node');
    return await create({
      cwd: path.dirname(configFile),
      configFilePath: configFile,
      formatter: 'stylish',
      color: false,
      // Documented as the default, but secretlint 13 prints the raw secret unless it's set.
      maskSecrets: true,
    });
  } finally {
    if (debug !== undefined) process.env['DEBUG'] = debug;
  }
}

function configFileOfThisModule(): string {
  return (config ??= findConfigFile(path.dirname(fileURLToPath(import.meta.url))));
}

/**
 * The roots whose gitignored dotenv files hold the live credentials: the checkout the config lives in
 * and the main worktree (a linked worktree has none of its own). Without git, the config directory.
 */
export function envRootsFor(configFile: string): string[] {
  return repoEnvRoots(path.dirname(configFile));
}

/**
 * Scan text headed for a demo doc. Returns a masked report headed by `label` when it holds a secret,
 * else `undefined`. Two checks: secretlint's patterns, and the live secret values this process holds
 * (credential-named env vars, the gitignored dotenv files of this checkout and the main one) in any
 * encoding — which catches output no pattern recognises, like a bare `printenv PGPASSWORD`. Neither
 * report prints a value.
 */
export async function findSecrets(content: string, label: string): Promise<string | undefined> {
  return findSecretsIn(content, label, (envRoots ??= envRootsFor(configFileOfThisModule())));
}

/** {@link findSecrets} reading dotenv files from `roots` instead of the repo's own. */
export async function findSecretsIn(
  content: string,
  label: string,
  roots: readonly string[],
): Promise<string | undefined> {
  engine ??= loadEngine(configFileOfThisModule());
  const scanner = await engine;
  // Same defence as tools/secret-scan: a `secretlint-disable` comment anywhere would silence it.
  const defused = content.replaceAll(/secretlint-(?=disable|enable)/g, 'secretlint_');
  const result = await scanner.executeOnContent({ content: defused, filePath: label });
  const live = knownSecretsReport(content, label, knownSecrets({ envRoots: roots }));
  const reports = [result.ok ? undefined : result.output, live].filter(
    (report): report is string => report !== undefined,
  );
  return reports.length === 0 ? undefined : reports.join('\n');
}
