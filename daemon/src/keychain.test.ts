import type { DaemonConfig } from './config.ts';
import {
  HMAC_SECRET_ACCOUNT,
  HMAC_SECRET_SERVICE,
  KeychainError,
  WORKMAIL_IMAP_SERVICE,
  WORKMAIL_PASSWORD_SECRET,
  createKeychain,
  createSecretResolver,
} from './keychain.ts';
import type { ExecFileLike } from './keychain.ts';

const SECRET = 'sup3r-secret-value';

interface Call {
  file: string;
  args: readonly string[];
}

/** Records what the keychain shelled out to, and answers with whatever the test wants back. */
function recordingExecFile(answer: () => Promise<{ stdout: string; stderr: string }>): {
  calls: Call[];
  execFile: ExecFileLike;
} {
  const calls: Call[] = [];
  return {
    calls,
    execFile: (file, args) => {
      calls.push({ file, args });
      return answer();
    },
  };
}

function resolving(stdout: string, stderr = ''): () => Promise<{ stdout: string; stderr: string }> {
  return () => Promise.resolve({ stdout, stderr });
}

describe('createKeychain', () => {
  it('reads an item with the macOS security CLI', async () => {
    const { calls, execFile } = recordingExecFile(resolving(`${SECRET}\n`));

    const value = await createKeychain(execFile).readSecret('a-service', 'an-account');

    expect(calls).toEqual([
      {
        file: 'security',
        args: ['find-generic-password', '-s', 'a-service', '-a', 'an-account', '-w'],
      },
    ]);
    expect(value).toBe(SECRET);
  });

  it('reads the ingest HMAC secret from its fixed item', async () => {
    const { calls, execFile } = recordingExecFile(resolving(SECRET));

    await createKeychain(execFile).readIngestSecret();

    expect(calls[0]?.args).toEqual([
      'find-generic-password',
      '-s',
      HMAC_SECRET_SERVICE,
      '-a',
      HMAC_SECRET_ACCOUNT,
      '-w',
    ]);
  });

  it('reads the WorkMail password under the configured mailbox user', async () => {
    const { calls, execFile } = recordingExecFile(resolving(SECRET));

    await createKeychain(execFile).readWorkmailPassword('support@realplayapp.com');

    expect(calls[0]?.args).toEqual([
      'find-generic-password',
      '-s',
      WORKMAIL_IMAP_SERVICE,
      '-a',
      'support@realplayapp.com',
      '-w',
    ]);
  });

  it('rejects an empty item rather than signing with an empty secret', async () => {
    const { execFile } = recordingExecFile(resolving('\n'));

    await expect(createKeychain(execFile).readIngestSecret()).rejects.toThrow(KeychainError);
  });

  it('explains how to create a missing item, naming the service and account', async () => {
    const { execFile } = recordingExecFile(() =>
      Promise.reject(new Error('The specified item could not be found')),
    );

    await expect(createKeychain(execFile).readIngestSecret()).rejects.toThrow(
      `security add-generic-password -s ${HMAC_SECRET_SERVICE} -a ${HMAC_SECRET_ACCOUNT}`,
    );
  });

  it('never puts the secret in the failure message', async () => {
    const { execFile } = recordingExecFile(resolving('   \n', SECRET));

    const failure: unknown = await createKeychain(execFile)
      .readIngestSecret()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KeychainError);
    expect(String(failure)).not.toContain(SECRET);
  });
});

const CONFIG: DaemonConfig = {
  ingestUrl: 'https://worker.example.com/comms/ingest',
  sources: {
    workmail: {
      enabled: true,
      host: 'imap.mail.us-east-1.awsapps.com',
      port: 993,
      user: 'support@realplayapp.com',
      label: 'WorkMail',
    },
  },
};

describe('createSecretResolver', () => {
  it('resolves the WorkMail password against the configured mailbox user', async () => {
    const { calls, execFile } = recordingExecFile(resolving(SECRET));

    const value = await createSecretResolver(
      createKeychain(execFile),
      CONFIG,
    )(WORKMAIL_PASSWORD_SECRET);

    expect(value).toBe(SECRET);
    expect(calls[0]?.args).toContain('support@realplayapp.com');
  });

  it('refuses a secret name it does not know, so a source cannot fish for one', async () => {
    const { execFile } = recordingExecFile(resolving(SECRET));

    await expect(
      createSecretResolver(createKeychain(execFile), CONFIG)('alfred-comms-hmac-secret'),
    ).rejects.toThrow('unknown secret "alfred-comms-hmac-secret"');
  });

  it('says which config section is missing when the mailbox is not configured', async () => {
    const { execFile } = recordingExecFile(resolving(SECRET));

    await expect(
      createSecretResolver(createKeychain(execFile), { ...CONFIG, sources: {} })(
        WORKMAIL_PASSWORD_SECRET,
      ),
    ).rejects.toThrow('needs a "sources.workmail" section');
  });
});
