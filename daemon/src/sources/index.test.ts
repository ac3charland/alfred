import type { DaemonConfig } from '../config.ts';
import { createSources } from './index.ts';

const CONFIG: DaemonConfig = {
  ingestUrl: 'https://worker.example.com/comms/ingest',
  sources: {
    imessage: { enabled: true, label: 'iMessage' },
    workmail: {
      enabled: true,
      host: 'imap.mail.us-east-1.awsapps.com',
      port: 993,
      user: 'support@realplayapp.com',
      label: 'WorkMail',
    },
  },
};

describe('createSources', () => {
  it('runs every enabled source', () => {
    expect(createSources(CONFIG).map((source) => source.key)).toEqual(['imessage', 'workmail']);
  });

  it('leaves out a disabled source', () => {
    const config: DaemonConfig = {
      ...CONFIG,
      sources: { ...CONFIG.sources, imessage: { enabled: false, label: 'iMessage' } },
    };

    expect(createSources(config).map((source) => source.key)).toEqual(['workmail']);
  });

  it('leaves out a source the config never mentions', () => {
    expect(createSources({ ...CONFIG, sources: {} })).toEqual([]);
  });

  it('honours a --source restriction', () => {
    expect(createSources(CONFIG, ['workmail']).map((source) => source.key)).toEqual(['workmail']);
  });
});
