import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readState, writeState } from './state.ts';

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'alfred-daemon-state-'));
}

describe('readState / writeState', () => {
  it('round-trips a per-source cursor and last-seen stamp', () => {
    const file = path.join(scratch(), 'state.json');
    const state = { imessage: { cursor: { rowid: 4211 }, lastSeenAt: '2026-09-09T12:00:00.000Z' } };

    writeState(file, state);

    expect(readState(file)).toEqual(state);
  });

  it('returns an empty state when the file has never been written', () => {
    expect(readState(path.join(scratch(), 'state.json'))).toEqual({});
  });

  it('treats an unreadable file as no state — a cache is never worth a crash', () => {
    const file = path.join(scratch(), 'state.json');
    writeFileSync(file, '{ half-written');

    expect(readState(file)).toEqual({});
  });

  it('creates the directory when the app-support folder does not exist yet', () => {
    const file = path.join(scratch(), 'nested', 'state.json');

    writeState(file, { workmail: { cursor: { uid: 12 } } });

    expect(readState(file)).toEqual({ workmail: { cursor: { uid: 12 } } });
  });

  it('leaves no temp file behind — the write lands by rename, never in place', () => {
    const directory = scratch();
    const file = path.join(directory, 'state.json');

    writeState(file, { imessage: { cursor: 1 } });
    writeState(file, { imessage: { cursor: 2 } });

    expect(readdirSync(directory)).toEqual(['state.json']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ imessage: { cursor: 2 } });
  });
});
