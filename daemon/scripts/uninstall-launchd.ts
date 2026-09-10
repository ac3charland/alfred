import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import process from 'node:process';

import { LAUNCHD_LABEL, plistPath } from './launchd.ts';

/** Reverses `install-launchd.ts`: stops the agent and removes its plist. Logs are left alone. */

const target = plistPath(homedir());
const domain = `gui/${String(userInfo().uid)}`;

const bootout = spawnSync('launchctl', ['bootout', `${domain}/${LAUNCHD_LABEL}`], {
  stdio: 'inherit',
});
process.stdout.write(
  bootout.status === 0
    ? `booted out ${domain}/${LAUNCHD_LABEL}\n`
    : `${LAUNCHD_LABEL} was not loaded\n`,
);

rmSync(target, { force: true });
process.stdout.write(`removed ${target}\n`);
