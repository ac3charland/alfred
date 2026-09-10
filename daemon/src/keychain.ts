/**
 * Secrets come from the macOS keychain, read through the `security` CLI. Never from a launchd
 * plist, a dotfile, an environment variable, or this repo.
 *
 * Two items, and their names are fixed because the install instructions in the README print the
 * `security add-generic-password` commands verbatim.
 */
import type { DaemonConfig } from './config.ts';

/** The HMAC secret the ingest endpoint verifies against. Shared with nothing else. */
export const HMAC_SECRET_SERVICE = 'alfred-comms-hmac-secret';
export const HMAC_SECRET_ACCOUNT = 'alfred-daemon';

/** The IMAP password. Its account is the configured mailbox user, so a re-addressed mailbox moves. */
export const WORKMAIL_IMAP_SERVICE = 'alfred-workmail-imap';

/** The names a source may ask `SourceContext.secrets` for. */
export const WORKMAIL_PASSWORD_SECRET = 'workmail-imap-password';

export class KeychainError extends Error {
  override name = 'KeychainError';
}

/** The shape of `promisify(child_process.execFile)`, narrowed to what this module uses. */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface Keychain {
  readSecret(service: string, account: string): Promise<string>;
  readIngestSecret(): Promise<string>;
  readWorkmailPassword(user: string): Promise<string>;
}

function howToAdd(service: string, account: string): string {
  return `security add-generic-password -s ${service} -a ${account} -w`;
}

export function createKeychain(execFile: ExecFileLike): Keychain {
  async function readSecret(service: string, account: string): Promise<string> {
    let stdout: string;
    try {
      // `-w` prints only the password. Nothing from the child's output is ever put in an error
      // message below, so a failure can never leak the value it was trying to read.
      ({ stdout } = await execFile('security', [
        'find-generic-password',
        '-s',
        service,
        '-a',
        account,
        '-w',
      ]));
    } catch {
      throw new KeychainError(
        `keychain item "${service}" (account "${account}") could not be read. ` +
          `Create it with: ${howToAdd(service, account)}`,
      );
    }

    const value = stdout.trim();
    if (value.length === 0) {
      throw new KeychainError(
        `keychain item "${service}" (account "${account}") is empty. ` +
          `Set it with: ${howToAdd(service, account)}`,
      );
    }
    return value;
  }

  return {
    readSecret,
    readIngestSecret: () => readSecret(HMAC_SECRET_SERVICE, HMAC_SECRET_ACCOUNT),
    readWorkmailPassword: (user: string) => readSecret(WORKMAIL_IMAP_SERVICE, user),
  };
}

/**
 * What `SourceContext.secrets` resolves. A source asks for a secret BY NAME and can only reach
 * the item that name maps to — it never sees the keychain interface, and never the ingest secret.
 */
export function createSecretResolver(
  keychain: Keychain,
  config: DaemonConfig,
): (name: string) => Promise<string> {
  return (name: string): Promise<string> => {
    if (name === WORKMAIL_PASSWORD_SECRET) {
      const workmail = config.sources.workmail;
      if (workmail === undefined) {
        return Promise.reject(
          new KeychainError(`secret "${name}" needs a "sources.workmail" section in the config`),
        );
      }
      return keychain.readWorkmailPassword(workmail.user);
    }
    return Promise.reject(new KeychainError(`unknown secret "${name}"`));
  };
}
