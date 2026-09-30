import { sampleIds, sampleable, verifyRecords } from './verify.ts';

const record = (id: string, cost = 1.5) => ({
  id,
  created_at: '2026-07-10T01:00:00Z',
  configured_model: 'claude-opus-5-5',
  title: 'titles are not verified',
  session_context: { model: 'claude-opus-5-5', effort_level: 'high', sources: [{ url: 'x' }] },
  external_metadata: { last_served_model: 'claude-opus-5-5', usage: { cost_usd: cost } },
});

describe('sampleIds', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `session_${String(i)}`);

  it('picks max(5, 5%) distinct ids', () => {
    expect(new Set(sampleIds(ids, { pct: 5, min: 5 })).size).toBe(20);
    expect(sampleIds(ids.slice(0, 40), { pct: 5, min: 5 })).toHaveLength(5);
  });

  it('never asks for more ids than exist', () => {
    expect(sampleIds(ids.slice(0, 3), { pct: 5, min: 5 })).toHaveLength(3);
  });

  it('only picks ids from the input', () => {
    const picked = sampleIds(ids, { pct: 10, min: 5 });
    expect(picked.every((id) => ids.includes(id))).toBe(true);
    expect(picked).toHaveLength(40);
  });
});

describe('sampleable', () => {
  it('leaves out sessions still working — their usage moves between the copy and the re-fetch', () => {
    const records = [
      { id: 'session_done', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED' },
      { id: 'session_live', status_bucket: 'SESSION_STATUS_BUCKET_WORKING' },
      { id: 'session_waiting', status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED' },
    ];
    expect(sampleable(records)).toEqual(['session_done', 'session_waiting']);
  });
});

describe('verifyRecords', () => {
  it('passes when every re-fetched record matches on the verified fields', () => {
    const copies = [record('session_a'), record('session_b')];
    const refetched = [record('session_a'), { ...record('session_b'), title: 'renamed since' }];
    expect(verifyRecords(copies, refetched)).toEqual([]);
  });

  it('reports a single differing cost_usd', () => {
    const mismatches = verifyRecords([record('session_a', 1.5)], [record('session_a', 1.6)]);
    expect(mismatches).toEqual([{ id: 'session_a', field: 'usage' }]);
  });

  it('reports a re-fetched session the copies lack', () => {
    expect(verifyRecords([], [record('session_a')])).toEqual([
      { id: 'session_a', field: 'missing from the subagent copies' },
    ]);
  });

  it('compares nested values regardless of key order', () => {
    const reordered = {
      ...record('session_a'),
      session_context: { sources: [{ url: 'x' }], effort_level: 'high', model: 'claude-opus-5-5' },
    };
    expect(verifyRecords([record('session_a')], [reordered])).toEqual([]);
  });
});
