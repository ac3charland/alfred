import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The launchd agent's identity and the plist rendering, kept apart from the install script's side
 * effects so the substitution can be tested.
 */

export const LAUNCHD_LABEL = 'com.alfred.comms-daemon';

/**
 * NODE_BIN is the absolute node binary — the one Full Disk Access must be granted to, since it is
 * the process that opens chat.db. MAIN_TS is the absolute daemon entry point.
 */
export type PlistPlaceholder = 'NODE_BIN' | 'MAIN_TS' | 'LOG_DIR' | 'PATH';

export type PlistValues = Record<PlistPlaceholder, string>;

export function plistPath(home: string = homedir()): string {
  return path.join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

export function logDirectory(home: string = homedir()): string {
  return path.join(home, 'Library', 'Logs', 'alfred-daemon');
}

/**
 * launchd starts the agent with a near-empty environment, so PATH is set explicitly and leads
 * with the directory of the node binary that is actually running the daemon.
 */
export function agentPath(nodeBin: string): string {
  return [path.dirname(nodeBin), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(
    ':',
  );
}

export function renderPlist(template: string, values: PlistValues): string {
  let rendered = template;
  for (const [name, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{{${name}}}`, value);
  }

  const leftover = /\{\{(\w+)\}\}/.exec(rendered);
  if (leftover !== null) {
    throw new Error(`launchd template still has an unsubstituted placeholder: ${leftover[0]}`);
  }
  return rendered;
}
