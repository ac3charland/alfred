import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { createEngine } from '@secretlint/node';

/**
 * The repo's single secretlint config — the same file `tools/secret-scan` (the commit gate)
 * reads, so the record-time guard and the gate can never disagree about what a secret is.
 */
const CONFIG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.secretlintrc.json',
);

type Engine = Awaited<ReturnType<typeof createEngine>>;

let engine: Promise<Engine> | undefined;

/**
 * Build the secretlint engine with `DEBUG` unset. secretlint logs through the `debug` module, which
 * reads `DEBUG` once as it loads and — with `DEBUG=@secretlint/*` — prints every scanned text's raw
 * content, secrets included. Loading it (and the rules `createEngine` imports) with the variable
 * removed leaves that logging off; the variable goes straight back, since `exec` children inherit it.
 */
async function loadEngine(): Promise<Engine> {
  const debug = process.env['DEBUG'];
  delete process.env['DEBUG'];
  try {
    const { createEngine: create } = await import('@secretlint/node');
    return await create({
      cwd: path.dirname(CONFIG_FILE),
      configFilePath: CONFIG_FILE,
      formatter: 'stylish',
      color: false,
      // Documented as the default, but secretlint 13 prints the raw secret unless it's set.
      maskSecrets: true,
    });
  } finally {
    if (debug !== undefined) process.env['DEBUG'] = debug;
  }
}

/**
 * Scan text headed for a demo doc. Returns secretlint's report (secrets masked, headed by
 * `label`) when it finds one, else `undefined`.
 */
export async function findSecrets(content: string, label: string): Promise<string | undefined> {
  engine ??= loadEngine();
  const scanner = await engine;
  // Same defence as tools/secret-scan: a `secretlint-disable` comment anywhere would silence it.
  const defused = content.replaceAll(/secretlint-(?=disable|enable)/g, 'secretlint_');
  const result = await scanner.executeOnContent({ content: defused, filePath: label });
  return result.ok ? undefined : result.output;
}
