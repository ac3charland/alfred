/**
 * Reading the Reader's two deploy vars, and refusing to run on a bad one.
 *
 * Both arrive as strings, because every `[vars]` entry does, and both are checked here rather
 * than trusted from the `Env` type: wrangler.toml's own comments warn that a CLI `--var` can
 * shadow a `[vars]` entry, so a var the type declares as `string` can still arrive `undefined`.
 * The ceiling is the money guard, and the one failure it must never have is an unparsable value
 * quietly becoming "unlimited" — so a bad value is a systemic failure the tick records and stops
 * on, before it touches Gmail or the model.
 */
import type { ReaderEnv } from './types';

/**
 * The daily ceiling when `READER_DAILY_CAP` is absent: three times a heavy day (eight to ten
 * posts).
 *
 * It counts model CALLS — one per post the tick attempts — and not HTTP requests to the API: the
 * SDK retries a transport failure once by itself, so a day where every call fails that way costs
 * up to twice the cap in requests. 30 is sized with that headroom in it.
 */
export const READER_DEFAULT_DAILY_CAP = 30;

/** The parsed vars the tick and the summariser build from. */
export interface ReaderConfig {
  model: string;
  /** A positive integer. */
  dailyCap: number;
}

/** The vars, parsed — or the one-line reason the tick must not run. */
export type ReaderConfigResult = { ok: true; config: ReaderConfig } | { ok: false; error: string };

/** A positive integer written in decimal digits and nothing else. */
const POSITIVE_INTEGER = /^\d+$/;

/**
 * Parse `READER_MODEL` and `READER_DAILY_CAP`. A missing model is fatal; a missing ceiling takes
 * the default; a present ceiling that is not a positive integer is fatal.
 */
export function readReaderConfig(
  env: Pick<ReaderEnv, 'READER_MODEL' | 'READER_DAILY_CAP'>,
): ReaderConfigResult {
  const model = env.READER_MODEL?.trim() ?? '';
  if (model === '') return { ok: false, error: 'READER_MODEL is not set' };

  const raw = env.READER_DAILY_CAP;
  if (raw === undefined) return { ok: true, config: { model, dailyCap: READER_DEFAULT_DAILY_CAP } };

  const trimmed = raw.trim();
  const dailyCap = POSITIVE_INTEGER.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
  if (!Number.isInteger(dailyCap) || dailyCap < 1) {
    return {
      ok: false,
      error: `READER_DAILY_CAP is not a positive integer: ${JSON.stringify(raw)}`,
    };
  }
  return { ok: true, config: { model, dailyCap } };
}
