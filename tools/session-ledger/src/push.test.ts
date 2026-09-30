import { pushRows } from './push.ts';
import type { LedgerRow } from './types.ts';

const rows = Array.from(
  { length: 250 },
  (_, i) => ({ session_id: `session_${String(i)}` }) as unknown as LedgerRow,
);

function recorder(fail?: number) {
  const calls: { url: string; headers: Record<string, string>; rows: number }[] = [];
  const fetchFn = (url: string, init: { headers: Record<string, string>; body: string }) => {
    const sent = (JSON.parse(init.body) as { rows: unknown[] }).rows.length;
    calls.push({ url, headers: init.headers, rows: sent });
    const ok = calls.length !== fail;
    return Promise.resolve({
      ok,
      status: ok ? 200 : 413,
      text: () =>
        Promise.resolve(
          ok ? JSON.stringify({ upserted: sent, kept_recorded: 1 }) : '{"error":"x"}',
        ),
    });
  };
  return { calls, fetchFn };
}

describe('pushRows', () => {
  it('posts in chunks of 100 and sums the counts', async () => {
    const { calls, fetchFn } = recorder();

    const result = await pushRows(rows, { baseUrl: 'https://alfred.example', fetchFn });

    expect(calls.map((c) => c.rows)).toEqual([100, 100, 50]);
    expect(calls[0]?.url).toBe('https://alfred.example/api/code/sessions');
    expect(result).toEqual({ pushed: 250, upserted: 250, kept_recorded: 3 });
  });

  it('sends Authorization only when a key is set — otherwise the proxy adds it', async () => {
    const withKey = recorder();
    await pushRows(rows.slice(0, 1), {
      baseUrl: 'https://alfred.example',
      key: 'k',
      fetchFn: withKey.fetchFn,
    });
    expect(withKey.calls[0]?.headers['authorization']).toBe('Bearer k');

    const without = recorder();
    await pushRows(rows.slice(0, 1), {
      baseUrl: 'https://alfred.example',
      fetchFn: without.fetchFn,
    });
    expect(without.calls[0]?.headers['authorization']).toBeUndefined();
  });

  it('stops at the first failed chunk', async () => {
    const { calls, fetchFn } = recorder(2);

    await expect(pushRows(rows, { baseUrl: 'https://alfred.example', fetchFn })).rejects.toThrow(
      /row 100 failed with 413/,
    );
    expect(calls).toHaveLength(2);
  });
});
