import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type FetchInput, spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { PRICING_PAGE_URL, runPriceRefresh } from './refresh';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const now = new Date('2026-10-03T09:17:00.000Z');

const page = readFileSync(path.join(__dirname, '__fixtures__', 'pricing-2026-09-30.txt'), 'utf8');

/** A history row holding the given ids, each with the same plausible rates. */
function historyRow(
  effectiveFrom: string,
  ids: string[],
): { effective_from: string; rates: object } {
  const rate = { name: 'x', in: 1, cw5m: 1.25, cw1h: 2, read: 0.1, out: 5 };
  return {
    effective_from: effectiveFrom,
    rates: Object.fromEntries(ids.map((id) => [id, rate])),
  };
}

/** The URL a fetch stub was asked for, whichever form the caller handed it. */
function urlOf(input: FetchInput): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

interface Stubbed {
  /** What the price history read returns. */
  history?: Response;
  /** What the page GET returns. */
  page?: Response;
  /** What the append RPC returns. */
  rpc?: Response;
}

/** Route the three calls a refresh makes; anything else is a test failure. */
function stubFetch(stubbed: Stubbed) {
  return spyOnFetch().mockImplementation((input) => {
    const url = urlOf(input);
    if (url === PRICING_PAGE_URL) {
      return Promise.resolve(stubbed.page ?? new Response(page));
    }
    if (url.includes('/rest/v1/model_price_history')) {
      return Promise.resolve(
        stubbed.history ?? Response.json([historyRow('2026-10-02T09:17:04.112+00:00', [])]),
      );
    }
    if (url.includes('/rest/v1/rpc/append_model_prices')) {
      return Promise.resolve(
        stubbed.rpc ?? Response.json([{ appended: false, changed: [], repriced: 0 }]),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const callsTo = (spy: ReturnType<typeof stubFetch>, part: string) =>
  spy.mock.calls.filter(([url]) => urlOf(url).includes(part));

describe('runPriceRefresh', () => {
  it('appends the parsed rates and reports what changed and how many sessions were re-priced', async () => {
    const spy = stubFetch({
      rpc: Response.json([{ appended: true, changed: ['claude-opus-5-5'], repriced: 212 }]),
    });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'appended',
      models: 19,
      changed: ['claude-opus-5-5'],
      repriced: 212,
    });

    const [rpc] = callsTo(spy, '/rest/v1/rpc/append_model_prices');
    const [url, init] = rpc as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/append_model_prices');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer service-role-key' });
    const body = JSON.parse(init.body as string) as {
      p_rates: Record<string, { in: number }>;
      p_source: string;
    };
    expect(body.p_source).toBe(PRICING_PAGE_URL);
    expect(Object.keys(body.p_rates)).toHaveLength(19);
    expect(body.p_rates['claude-opus-5-5']).toEqual({
      name: 'Claude Opus 5.5',
      in: 4,
      cw5m: 5,
      cw1h: 8,
      read: 0.2,
      out: 20,
    });
  });

  it('reports an unchanged table when nothing was appended', async () => {
    stubFetch({});

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'unchanged',
      models: 19,
      repriced: 0,
    });
  });

  it('reads only the newest history row, for its ids and its date', async () => {
    const spy = stubFetch({});

    await runPriceRefresh(env, now);

    const [read] = callsTo(spy, '/rest/v1/model_price_history');
    const [url, init] = read as [string, RequestInit];
    expect(url).toBe(
      'https://proj.supabase.co/rest/v1/model_price_history' +
        '?select=effective_from,rates&order=effective_from.desc&limit=1',
    );
    expect(init.headers).toMatchObject({
      apikey: 'service-role-key',
      Authorization: 'Bearer service-role-key',
    });
  });

  it('rejects a page that lost most of the known models, makes no RPC call, and names the table it kept', async () => {
    const spy = stubFetch({
      history: Response.json([
        historyRow('2026-10-02T09:17:04.112+00:00', [
          'claude-opus-6',
          'claude-opus-7',
          'claude-opus-8',
        ]),
      ]),
    });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'rejected',
      reason: '3 of 3 known models missing',
      kept: '2026-10-02',
    });

    expect(callsTo(spy, '/rest/v1/rpc/append_model_prices')).toEqual([]);
  });

  it('rejects a page whose table is malformed and says so', async () => {
    const spy = stubFetch({ page: new Response('# Pricing\n\nNo table today.\n') });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'header not found',
      kept: '2026-10-02',
    });

    expect(callsTo(spy, '/rest/v1/rpc/append_model_prices')).toEqual([]);
  });

  it('keeps no table when the history is still empty', async () => {
    stubFetch({ history: Response.json([]), page: new Response('nothing') });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'header not found',
      kept: undefined,
    });
  });

  it('accepts any page on the first run, when there is no history to compare with', async () => {
    const spy = stubFetch({
      history: Response.json([]),
      rpc: Response.json([{ appended: true, changed: ['claude-opus-5-5'], repriced: 3 }]),
    });

    const summary = await runPriceRefresh(env, now);

    expect(summary.outcome).toBe('appended');
    expect(callsTo(spy, '/rest/v1/rpc/append_model_prices')).toHaveLength(1);
  });

  it('fetches the page with a plain, credential-free, time-limited markdown GET', async () => {
    const spy = stubFetch({});

    await runPriceRefresh(env, now);

    const pageCall = spy.mock.calls.find(([url]) => urlOf(url) === PRICING_PAGE_URL);
    const [url, init] = pageCall as [string, RequestInit];
    expect(url).toBe('https://platform.claude.com/docs/en/about-claude/pricing.md');
    expect(init.method ?? 'GET').toBe('GET');
    // Nothing else rides along: no body, no credentials mode, no Workers-specific options.
    expect(new Set(Object.keys(init))).toEqual(new Set(['headers', 'method', 'signal']));

    const sent = new Headers(init.headers);
    expect(sent.get('Accept')).toBe('text/markdown');
    expect(sent.has('Authorization')).toBe(false);
    expect(sent.has('Cookie')).toBe(false);
    expect(sent.has('apikey')).toBe(false);
    expect([...sent.keys()]).toEqual(['accept']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives the page fetch ten seconds', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    stubFetch({});

    await runPriceRefresh(env, now);

    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it('reports a page that answers with an error status as a failure, and calls nothing else', async () => {
    const spy = stubFetch({ page: new Response('unavailable', { status: 503 }) });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'failed',
      error: 'page 503',
    });

    expect(callsTo(spy, '/rest/v1/')).toEqual([]);
  });

  it('reports a page fetch that throws or times out as a failure', async () => {
    spyOnFetch().mockRejectedValue(new Error('The operation was aborted due to timeout'));

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'failed',
      error: 'page: The operation was aborted due to timeout',
    });
  });

  it('reports a failed history read as a failure without appending', async () => {
    const spy = stubFetch({ history: new Response('boom', { status: 500 }) });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'failed',
      error: 'history read 500',
    });

    expect(callsTo(spy, '/rest/v1/rpc/append_model_prices')).toEqual([]);
  });

  it('reports a failed append as a failure', async () => {
    stubFetch({ rpc: new Response('permission denied', { status: 401 }) });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'failed',
      error: 'append 401',
    });
  });

  it('reports an append answer it cannot read as a failure', async () => {
    stubFetch({ rpc: Response.json({ message: 'surprise' }) });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'failed',
      error: 'append: unexpected response',
    });
  });

  it('reports a history it cannot read as a failure', async () => {
    stubFetch({ history: Response.json({ message: 'surprise' }) });

    await expect(runPriceRefresh(env, now)).resolves.toEqual({
      outcome: 'failed',
      error: 'history read: unexpected response',
    });
  });
});
