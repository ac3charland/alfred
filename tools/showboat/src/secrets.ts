import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEngine } from '@secretlint/node';

/**
 * The repo's single secretlint config — the same file `tools/secret-scan` (the commit gate)
 * reads, so the record-time guard and the gate can never disagree about what a secret is.
 */
const CONFIG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.secretlintrc.json',
);

let engine: ReturnType<typeof createEngine> | undefined;

/**
 * Scan text headed for a demo doc. Returns secretlint's report (secrets masked, headed by
 * `label`) when it finds one, else `undefined`.
 */
export async function findSecrets(content: string, label: string): Promise<string | undefined> {
  engine ??= createEngine({
    cwd: path.dirname(CONFIG_FILE),
    configFilePath: CONFIG_FILE,
    formatter: 'stylish',
    color: false,
    // Documented as the default, but secretlint 13 prints the raw secret unless it's set.
    maskSecrets: true,
  });
  const scanner = await engine;
  // Same defence as tools/secret-scan: a `secretlint-disable` comment anywhere would silence it.
  const defused = content.replaceAll(/secretlint-(?=disable|enable)/g, 'secretlint_');
  const result = await scanner.executeOnContent({ content: defused, filePath: label });
  return result.ok ? undefined : result.output;
}
