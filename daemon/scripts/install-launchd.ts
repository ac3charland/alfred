import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LAUNCHD_LABEL, agentPath, logDirectory, plistPath, renderPlist } from './launchd.ts';

/**
 * Installs the launchd agent that keeps the daemon running across logins and reboots.
 *
 * The node binary is baked into the plist as an absolute path, and it is printed at the end
 * because Full Disk Access must be granted to THAT binary — the one that opens chat.db — not to
 * Terminal, and not to a different node on the PATH. FDA grants have been observed to reset
 * across macOS updates, which is why the agent runs the health check on every start.
 */

const daemonRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = homedir();
const target = plistPath(home);
const logs = logDirectory(home);

const rendered = renderPlist(
  readFileSync(path.join(daemonRoot, 'launchd', `${LAUNCHD_LABEL}.plist`), 'utf8'),
  {
    NODE_BIN: process.execPath,
    MAIN_TS: path.join(daemonRoot, 'src', 'main.ts'),
    LOG_DIR: logs,
    PATH: agentPath(process.execPath),
  },
);

mkdirSync(logs, { recursive: true });
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, rendered, 'utf8');
process.stdout.write(`wrote ${target}\n`);

const domain = `gui/${String(userInfo().uid)}`;

// An agent that was never loaded makes this fail; that is the normal first-install case.
spawnSync('launchctl', ['bootout', `${domain}/${LAUNCHD_LABEL}`], { stdio: 'ignore' });

const bootstrap = spawnSync('launchctl', ['bootstrap', domain, target], { stdio: 'inherit' });
if (bootstrap.status === 0) {
  process.stdout.write(`bootstrapped ${domain}/${LAUNCHD_LABEL}\n`);
} else {
  process.stderr.write(`launchctl bootstrap failed (exit ${String(bootstrap.status)})\n`);
  process.exitCode = 1;
}

process.stdout.write(
  [
    '',
    'Two things to check before it can read anything:',
    '',
    '  1. Full Disk Access — System Settings → Privacy & Security → Full Disk Access,',
    '     add EXACTLY this binary (the one that opens chat.db):',
    '',
    `       ${process.execPath}`,
    '',
    '  2. The health check passes:',
    '',
    '       npm run start -w daemon -- --check',
    '',
    `Logs: ${logs}/daemon.log and ${logs}/daemon.error.log`,
    '',
  ].join('\n'),
);
