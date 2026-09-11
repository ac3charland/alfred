import { ConfigError } from './config.ts';
import type { DaemonConfig } from './config.ts';
import { fatalFailures, runHealthChecks } from './health.ts';
import { HMAC_SECRET_SERVICE, KeychainError } from './keychain.ts';
import type { Source } from './sources/types.ts';

const CONFIG: DaemonConfig = {
  ingestUrl: 'https://worker.example.com/comms/ingest',
  sources: { imessage: { enabled: true, label: 'iMessage' } },
};

function source(overrides: Partial<Source> = {}): Source {
  return {
    key: 'imessage',
    kind: 'imessage',
    label: 'iMessage',
    check: () => Promise.resolve({ ok: true }),
    poll: () => Promise.reject(new Error('not polled in a health check')),
    ...overrides,
  };
}

describe('runHealthChecks', () => {
  it('passes when the config parses, the secret reads, and every source is ready', async () => {
    const report = await runHealthChecks({
      loadConfig: () => CONFIG,
      readIngestSecret: () => Promise.resolve('a-secret'),
      createSources: () => [source()],
    });

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      'config',
      `keychain: ${HMAC_SECRET_SERVICE}`,
      'source: iMessage',
    ]);
  });

  it('stops at a broken config — nothing downstream can be judged without it', async () => {
    let secretRead = false;

    const report = await runHealthChecks({
      loadConfig: () => {
        throw new ConfigError('config.json: "ingestUrl" is required and must be an http(s) URL');
      },
      readIngestSecret: () => {
        secretRead = true;
        return Promise.resolve('a-secret');
      },
      createSources: () => [source()],
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual([
      {
        name: 'config',
        ok: false,
        error: 'config.json: "ingestUrl" is required and must be an http(s) URL',
      },
    ]);
    expect(secretRead).toBe(false);
  });

  it('still checks the sources when the keychain item is missing, so one run reports everything', async () => {
    const report = await runHealthChecks({
      loadConfig: () => CONFIG,
      readIngestSecret: () => Promise.reject(new KeychainError('item could not be read')),
      createSources: () => [source()],
    });

    expect(report.ok).toBe(false);
    expect(report.checks[1]).toEqual({
      name: `keychain: ${HMAC_SECRET_SERVICE}`,
      ok: false,
      error: 'item could not be read',
    });
    expect(report.checks[2]?.ok).toBe(true);
  });

  it('fails loudly when a source cannot read what it polls', async () => {
    const report = await runHealthChecks({
      loadConfig: () => CONFIG,
      readIngestSecret: () => Promise.resolve('a-secret'),
      createSources: () => [
        source({
          check: () =>
            Promise.resolve({
              ok: false,
              error: 'chat.db: operation not permitted (Full Disk Access)',
            }),
        }),
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.checks[2]).toEqual({
      name: 'source: iMessage',
      ok: false,
      error: 'chat.db: operation not permitted (Full Disk Access)',
    });
  });

  it('treats a thrown source check as a failed one', async () => {
    const report = await runHealthChecks({
      loadConfig: () => CONFIG,
      readIngestSecret: () => Promise.resolve('a-secret'),
      createSources: () => [source({ check: () => Promise.reject(new Error('boom')) })],
    });

    expect(report.checks[2]).toEqual({ name: 'source: iMessage', ok: false, error: 'boom' });
  });

  it('fails when no source is enabled — a daemon with nothing to poll is misconfigured', async () => {
    const report = await runHealthChecks({
      loadConfig: () => ({ ...CONFIG, sources: {} }),
      readIngestSecret: () => Promise.resolve('a-secret'),
      createSources: () => [],
    });

    expect(report.ok).toBe(false);
    expect(report.checks.at(-1)).toEqual({
      name: 'sources',
      ok: false,
      error: 'no source is enabled — nothing would be polled',
    });
  });
});

describe('fatalFailures', () => {
  it('finds nothing to stop for in a healthy report', () => {
    expect(fatalFailures({ ok: true, checks: [{ name: 'config', ok: true }] })).toEqual([]);
  });

  it('treats an unreadable config as fatal', () => {
    const check = { name: 'config', ok: false, error: 'not valid JSON' };

    expect(fatalFailures({ ok: false, checks: [check] })).toEqual([check]);
  });

  it('treats a missing HMAC secret as fatal — nothing could ever be delivered', () => {
    const check = { name: `keychain: ${HMAC_SECRET_SERVICE}`, ok: false, error: 'missing' };

    expect(fatalFailures({ ok: false, checks: [check] })).toEqual([check]);
  });

  it('treats an empty source list as fatal', () => {
    const check = { name: 'sources', ok: false, error: 'no source is enabled' };

    expect(fatalFailures({ ok: false, checks: [check] })).toEqual([check]);
  });

  it('keeps running through a failing source, so its error reaches the server every minute', () => {
    const checks = [
      { name: 'config', ok: true },
      { name: 'source: iMessage', ok: false, error: 'Full Disk Access' },
    ];

    expect(fatalFailures({ ok: false, checks })).toEqual([]);
  });
});
