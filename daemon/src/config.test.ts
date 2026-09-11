import { ConfigError, configPathFrom, parseConfig, stateFilePathFor } from './config.ts';

const PATH = '/Users/owner/Library/Application Support/alfred-daemon/config.json';

const VALID = JSON.stringify({
  ingestUrl: 'https://worker.example.com/comms/ingest',
  sources: {
    imessage: { enabled: true },
    workmail: {
      enabled: true,
      host: 'imap.mail.us-east-1.awsapps.com',
      port: 993,
      user: 'support@realplayapp.com',
      label: 'WorkMail',
    },
  },
});

describe('parseConfig', () => {
  it('reads the ingest URL and both sources', () => {
    const config = parseConfig(VALID, PATH);

    expect(config.ingestUrl).toBe('https://worker.example.com/comms/ingest');
    expect(config.sources.workmail).toEqual({
      enabled: true,
      host: 'imap.mail.us-east-1.awsapps.com',
      port: 993,
      user: 'support@realplayapp.com',
      label: 'WorkMail',
    });
  });

  it('defaults the iMessage label so the config only has to say enabled', () => {
    expect(parseConfig(VALID, PATH).sources.imessage).toEqual({ enabled: true, label: 'iMessage' });
  });

  it('treats an omitted source as disabled rather than an error', () => {
    const config = parseConfig(
      JSON.stringify({ ingestUrl: 'https://x/ingest', sources: { imessage: { enabled: true } } }),
      PATH,
    );

    expect(config.sources.workmail).toBeUndefined();
  });

  it('names the file and the syntax problem when the JSON is broken', () => {
    expect(() => parseConfig('{ nope', PATH)).toThrow(ConfigError);
    expect(() => parseConfig('{ nope', PATH)).toThrow(new RegExp(`^${PATH}: not valid JSON`));
  });

  it('rejects a document that is not an object', () => {
    expect(() => parseConfig('[]', PATH)).toThrow(`${PATH}: expected a JSON object`);
  });

  it('requires an ingest URL', () => {
    expect(() => parseConfig(JSON.stringify({ sources: {} }), PATH)).toThrow(
      `${PATH}: "ingestUrl" is required and must be an http(s) URL`,
    );
  });

  it('rejects an ingest URL that is not http(s)', () => {
    expect(() =>
      parseConfig(JSON.stringify({ ingestUrl: 'ftp://x/ingest', sources: {} }), PATH),
    ).toThrow(`${PATH}: "ingestUrl" is required and must be an http(s) URL`);
  });

  it('requires the sources object', () => {
    expect(() => parseConfig(JSON.stringify({ ingestUrl: 'https://x/ingest' }), PATH)).toThrow(
      `${PATH}: "sources" is required and must be an object`,
    );
  });

  it('names an unknown source rather than ignoring it', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ ingestUrl: 'https://x/ingest', sources: { gmail: { enabled: true } } }),
        PATH,
      ),
    ).toThrow(`${PATH}: unknown source "gmail" — the daemon polls "imessage" and "workmail"`);
  });

  it('requires "enabled" to be a boolean', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          ingestUrl: 'https://x/ingest',
          sources: { imessage: { enabled: 'yes' } },
        }),
        PATH,
      ),
    ).toThrow(`${PATH}: "sources.imessage.enabled" must be true or false`);
  });

  it('requires the WorkMail connection details whenever the source is configured', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          ingestUrl: 'https://x/ingest',
          sources: { workmail: { enabled: false, port: 993, user: 'a@b.c', label: 'WorkMail' } },
        }),
        PATH,
      ),
    ).toThrow(`${PATH}: "sources.workmail.host" is required and must be a string`);
  });

  it('requires the WorkMail port to be an integer', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          ingestUrl: 'https://x/ingest',
          sources: {
            workmail: { enabled: true, host: 'h', port: 993.5, user: 'a@b.c', label: 'WorkMail' },
          },
        }),
        PATH,
      ),
    ).toThrow(`${PATH}: "sources.workmail.port" must be an integer`);
  });
});

describe('configPathFrom', () => {
  it('defaults to the app-support directory under the owner home', () => {
    expect(configPathFrom({}, '/Users/owner')).toBe(
      '/Users/owner/Library/Application Support/alfred-daemon/config.json',
    );
  });

  it('honours the ALFRED_DAEMON_CONFIG override', () => {
    expect(configPathFrom({ ALFRED_DAEMON_CONFIG: '/tmp/alt.json' }, '/Users/owner')).toBe(
      '/tmp/alt.json',
    );
  });
});

describe('stateFilePathFor', () => {
  it('keeps the cursor cache beside the config it belongs to', () => {
    expect(stateFilePathFor('/tmp/alfred/config.json')).toBe('/tmp/alfred/state.json');
  });
});
