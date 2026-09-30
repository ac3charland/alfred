import os from 'node:os';
import process from 'node:process';

import { gitIn } from '../git.ts';
import { runHook } from './run.ts';

/**
 * `node cli.ts session-start|stop [--dry-run]`, wired to Claude Code's SessionStart and Stop
 * hooks in .claude/settings.json. Whatever happens it exits 0 and prints nothing, so it can
 * never block or clutter a session.
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const projectDir = process.env['CLAUDE_PROJECT_DIR'];

try {
  await runHook(process.argv.slice(2), {
    env: process.env,
    fetch: globalThis.fetch,
    readStdin,
    git: gitIn(projectDir === undefined || projectDir === '' ? process.cwd() : projectDir),
    now: () => new Date(),
    tmpDir: os.tmpdir(),
    write: (text) => process.stdout.write(text),
  });
} catch {
  // A hook never fails the session.
}
process.exitCode = 0;
