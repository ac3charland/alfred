import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseRecordLine,
  readSessionDir,
  sessionFields,
  touchesRepo,
  verifiedFields,
} from './records.ts';

/** An invented session record in the live get_session shape. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session_01Alpha',
    title: 'ALF-9: a fixture story',
    created_at: '2026-09-30T02:42:53.123Z',
    status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED',
    configured_model: 'claude-sonnet-5-5',
    session_context: {
      sources: [{ git_repository: { url: 'https://github.com/ac3charland/alfred' } }],
      model: 'claude-sonnet-5-5',
      effort_level: 'xhigh',
    },
    external_metadata: {
      last_served_model: 'claude-opus-5-5',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_tokens: 30,
        cache_write_tokens: 40,
        cost_usd: 1.25,
      },
    },
    ...overrides,
  };
}

describe('parseRecordLine', () => {
  it('accepts a bare record', () => {
    const parsed = parseRecordLine(JSON.stringify(record()));
    expect(parsed).toEqual({ kind: 'record', record: record() });
  });

  it('unwraps the MCP tool’s {"ccr": …} envelope', () => {
    const parsed = parseRecordLine(JSON.stringify({ ccr: record() }));
    expect(parsed).toEqual({ kind: 'record', record: record() });
  });

  it('reads a subagent’s {"id", "unavailable"} line as a record that could not be fetched', () => {
    const parsed = parseRecordLine('{"id":"session_01Gone","unavailable":"not found"}');
    expect(parsed).toEqual({ kind: 'unavailable', id: 'session_01Gone' });
  });

  it.each([
    ['not JSON', '{nope', undefined],
    ['a JSON array', '[1]', undefined],
    ['no id', JSON.stringify({ ...record(), id: undefined }), undefined],
    ['a malformed id', JSON.stringify(record({ id: 'sess-1' })), undefined],
    ['no created_at', JSON.stringify(record({ created_at: undefined })), 'session_01Alpha'],
    [
      'an unparseable created_at',
      JSON.stringify(record({ created_at: 'soon' })),
      'session_01Alpha',
    ],
    ['no session_context', JSON.stringify(record({ session_context: 'x' })), 'session_01Alpha'],
    [
      'a non-numeric usage field',
      JSON.stringify(record({ external_metadata: { usage: { cost_usd: '1.25' } } })),
      'session_01Alpha',
    ],
  ])('flags %s as invalid, keeping the id when one is readable', (_label, line, id) => {
    expect(parseRecordLine(line)).toMatchObject({ kind: 'invalid', id });
  });
});

describe('readSessionDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ledger-records-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads every .ndjson batch, skipping blank lines and other files', () => {
    writeFileSync(
      path.join(dir, 'b1.ndjson'),
      `${JSON.stringify(record())}\n\n{"id":"session_01Gone","unavailable":true}\n`,
    );
    writeFileSync(
      path.join(dir, 'b2.ndjson'),
      `${JSON.stringify(record({ id: 'session_01Beta' }))}\n{broken\n`,
    );
    writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const read = readSessionDir(dir);

    expect(read.records.map((r) => r['id'])).toEqual(['session_01Alpha', 'session_01Beta']);
    expect(read.unavailable).toEqual(['session_01Gone']);
    expect(read.invalid).toEqual([
      expect.objectContaining({ file: 'b2.ndjson', line: 2, id: undefined }),
    ]);
  });

  it('keeps the first copy of a session fetched twice', () => {
    writeFileSync(
      path.join(dir, 'b1.ndjson'),
      `${JSON.stringify(record())}\n${JSON.stringify(record({ title: 'later copy' }))}\n`,
    );

    expect(readSessionDir(dir).records.map((r) => r['title'])).toEqual(['ALF-9: a fixture story']);
  });
});

/** A record whose only source is `url`. */
function sourcedFrom(url: string): Record<string, unknown> {
  return record({ session_context: { sources: [{ git_repository: { url } }] } });
}

describe('touchesRepo', () => {
  it('matches a source URL for the repo', () => {
    expect(touchesRepo(record(), 'ac3charland/alfred')).toBe(true);
  });

  it('does not match a repo whose name merely starts the same way, or another owner', () => {
    expect(
      touchesRepo(sourcedFrom('https://github.com/ac3charland/alfred-site'), 'ac3charland/alfred'),
    ).toBe(false);
    expect(
      touchesRepo(sourcedFrom('https://github.com/someone/alfred'), 'ac3charland/alfred'),
    ).toBe(false);
    expect(
      touchesRepo(sourcedFrom('https://github.com/ac3charland/alfred.git'), 'ac3charland/alfred'),
    ).toBe(true);
  });

  it('is false when there are no sources', () => {
    expect(touchesRepo(record({ session_context: {} }), 'ac3charland/alfred')).toBe(false);
  });
});

describe('sessionFields', () => {
  it('maps the record onto the ledger’s session columns', () => {
    expect(sessionFields(record())).toEqual({
      title: 'ALF-9: a fixture story',
      session_created_at: '2026-09-30T02:42:53.123Z',
      status: 'SESSION_STATUS_BUCKET_COMPLETED',
      configured_model: 'claude-sonnet-5-5',
      model: 'claude-sonnet-5-5',
      served_model: 'claude-opus-5-5',
      effort_level: 'xhigh',
      cost_usd: 1.25,
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_write_tokens: 40,
    });
  });

  it('leaves absent values null rather than inventing them', () => {
    const fields = sessionFields(record({ external_metadata: {}, configured_model: undefined }));
    expect(fields.cost_usd).toBeNull();
    expect(fields.served_model).toBeNull();
    expect(fields.configured_model).toBeNull();
  });
});

describe('verifiedFields', () => {
  it('picks exactly the fields the ledger derives from', () => {
    expect(verifiedFields(record())).toEqual({
      created_at: '2026-09-30T02:42:53.123Z',
      configured_model: 'claude-sonnet-5-5',
      model: 'claude-sonnet-5-5',
      served_model: 'claude-opus-5-5',
      effort_level: 'xhigh',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_tokens: 30,
        cache_write_tokens: 40,
        cost_usd: 1.25,
      },
      sources: [{ git_repository: { url: 'https://github.com/ac3charland/alfred' } }],
    });
  });
});
