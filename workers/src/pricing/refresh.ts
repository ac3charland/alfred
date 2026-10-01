/**
 * The daily price refresh: read Anthropic's pricing page, and hand a clean parse of it to the
 * database, which appends a dated entry to the price history only if some rate changed and
 * re-prices every recorded session against the result.
 *
 * It spends three subrequests — the page, the history read, the append — and is written to NEVER
 * throw: a failed day becomes a summary the caller logs, and the next day's tick is the retry.
 */
import { type SupabaseEnv, headers } from '../supabase';
import { ParseError, type Rates, parsePricingPage } from './page';

/** The pricing page, served as markdown. Also the `source` recorded on every history entry. */
export const PRICING_PAGE_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';

const PAGE_TIMEOUT_MS = 10_000;

/** What one refresh did, for the caller to log as one line. */
export type PriceRefreshSummary =
  /** Some rate changed (or a model is new): a history entry was appended. */
  | { outcome: 'appended'; models: number; changed: string[]; repriced: number }
  /** The page matched the history: nothing was written. */
  | { outcome: 'unchanged'; models: number; repriced: number }
  /** The page did not look like the table it was written against: nothing was written. */
  | { outcome: 'rejected'; reason: string; kept: string | undefined }
  /** A call failed before the outcome was known: nothing is known to have been written. */
  | { outcome: 'failed'; error: string };

/** What the database's append function answers with, one row. */
interface AppendResult {
  appended: boolean;
  changed: string[];
  repriced: number;
}

/**
 * The latest history entry: the date it took effect, and the ids the page listed at the last fetch
 * that confirmed it. Not every id the table prices: the history keeps retired models' rates for
 * old sessions, so comparing against those would reject every fetch once enough had retired.
 */
interface LatestPrices {
  /** `YYYY-MM-DD` of its `effective_from`. */
  date: string;
  ids: Set<string>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One call, with the failure named by step: a rejected fetch reads `<step>: <why>`, a non-2xx
 * answer reads `<step> <status>` — so the log line says which of the three calls broke.
 */
async function call(step: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(`${step}: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`${step} ${String(response.status)}`);
  return response;
}

/**
 * The pricing page as markdown. A plain public GET, deliberately bare: no Authorization header,
 * no cookies, nothing of alfred's attached to a request that leaves for someone else's server.
 */
async function fetchPage(): Promise<string> {
  const response = await call('page', PRICING_PAGE_URL, {
    method: 'GET',
    headers: { Accept: 'text/markdown' },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  return response.text();
}

/** The newest history entry, or undefined while the history is still empty. */
async function readLatest(env: SupabaseEnv): Promise<LatestPrices | undefined> {
  const url =
    `${env.SUPABASE_URL}/rest/v1/model_price_history` +
    '?select=effective_from,fetched&order=effective_from.desc&limit=1';
  const response = await call('history read', url, { headers: headers(env) });
  const body: unknown = await response.json();

  if (!Array.isArray(body)) throw new Error('history read: unexpected response');
  const [row] = body as (Partial<{ effective_from: string; fetched: unknown }> | undefined)[];
  if (row === undefined) return undefined;
  if (typeof row.effective_from !== 'string' || !Array.isArray(row.fetched)) {
    throw new TypeError('history read: unexpected response');
  }
  const ids = row.fetched.filter((id): id is string => typeof id === 'string');
  return { date: row.effective_from.slice(0, 10), ids: new Set(ids) };
}

/** Ask the database to merge, append if anything changed, and re-price recorded sessions. */
async function append(env: SupabaseEnv, rates: Rates): Promise<AppendResult> {
  const response = await call('append', `${env.SUPABASE_URL}/rest/v1/rpc/append_model_prices`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ p_rates: rates, p_source: PRICING_PAGE_URL }),
  });
  const body: unknown = await response.json();

  const [row] = Array.isArray(body) ? (body as Partial<AppendResult>[]) : [];
  if (
    typeof row?.appended !== 'boolean' ||
    !Array.isArray(row.changed) ||
    typeof row.repriced !== 'number'
  ) {
    throw new TypeError('append: unexpected response');
  }
  return { appended: row.appended, changed: row.changed, repriced: row.repriced };
}

/**
 * Run one refresh. `_now` is unused — the history dates itself in the database — and is only here
 * so the unit has the same `(env, now)` shape as its siblings on the daily tick.
 */
export async function runPriceRefresh(env: SupabaseEnv, _now: Date): Promise<PriceRefreshSummary> {
  try {
    const markdown = await fetchPage();
    const latest = await readLatest(env);

    const rates = parsePricingPage(markdown, latest?.ids ?? new Set());
    if (rates instanceof ParseError) {
      return { outcome: 'rejected', reason: rates.reason, kept: latest?.date };
    }

    const models = Object.keys(rates).length;
    const result = await append(env, rates);
    return result.appended
      ? { outcome: 'appended', models, changed: result.changed, repriced: result.repriced }
      : { outcome: 'unchanged', models, repriced: result.repriced };
  } catch (error) {
    return { outcome: 'failed', error: errorMessage(error) };
  }
}
