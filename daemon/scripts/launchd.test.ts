import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAUNCHD_LABEL, agentPath, logDirectory, plistPath, renderPlist } from './launchd.ts';

const TEMPLATE = readFileSync(
  path.join(
    path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    'launchd',
    `${LAUNCHD_LABEL}.plist`,
  ),
  'utf8',
);

const VALUES = {
  NODE_BIN: '/opt/homebrew/bin/node',
  MAIN_TS: '/Users/owner/code/alfred/daemon/src/main.ts',
  LOG_DIR: '/Users/owner/Library/Logs/alfred-daemon',
  PATH: '/opt/homebrew/bin:/usr/bin:/bin',
};

describe('renderPlist', () => {
  it('substitutes every placeholder in the committed template', () => {
    const rendered = renderPlist(TEMPLATE, VALUES);

    expect(rendered).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(rendered).toContain('<string>/Users/owner/code/alfred/daemon/src/main.ts</string>');
    expect(rendered).toContain(
      '<string>/Users/owner/Library/Logs/alfred-daemon/daemon.log</string>',
    );
    expect(rendered).not.toContain('{{');
  });

  it('keeps the settings the spike called for', () => {
    const rendered = renderPlist(TEMPLATE, VALUES);

    expect(rendered).toContain('<key>RunAtLoad</key>');
    expect(rendered).toContain('<key>ProcessType</key>\n    <string>Interactive</string>');
    expect(rendered).toContain('<key>SuccessfulExit</key>');
  });

  it('refuses a template it could not fully fill, rather than installing a broken agent', () => {
    expect(() => renderPlist('<string>{{NOPE}}</string>', VALUES)).toThrow(
      'unsubstituted placeholder: {{NOPE}}',
    );
  });
});

describe('paths', () => {
  it('installs the agent where launchd looks for user agents', () => {
    expect(plistPath('/Users/owner')).toBe(
      `/Users/owner/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`,
    );
  });

  it('logs under the user Logs folder', () => {
    expect(logDirectory('/Users/owner')).toBe('/Users/owner/Library/Logs/alfred-daemon');
  });

  it('leads PATH with the directory of the node binary that will run the daemon', () => {
    expect(agentPath('/opt/homebrew/bin/node').split(':', 1)[0]).toBe('/opt/homebrew/bin');
  });
});
