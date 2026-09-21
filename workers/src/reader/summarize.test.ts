import Anthropic from '@anthropic-ai/sdk';

import { READER_MODEL_INPUT_CHARS, buildReaderRequest } from './prompt';
import { READER_SUMMARY_SCHEMA } from './schema';
import {
  READER_MAX_RETRIES,
  READER_MAX_TOKENS,
  READER_REQUEST_TIMEOUT_MS,
  summarizePost,
} from './summarize';
import type { ReaderSummary, SummaryConfig, SummaryInput } from './types';

const config: SummaryConfig = { apiKey: 'sk-ant-test-key', model: 'claude-sonnet-5' };

/** The wire value the SDK types as `null` on `RefusalStopDetails` — the package bans the literal. */
const WIRE_NULL: unknown = JSON.parse('null');

const post: SummaryInput = {
  publication: 'The Diff',
  author: 'Dana Whitfield',
  title: 'The inference cost curve, eighteen months on',
  receivedAt: '2026-09-14T06:03:00.000Z',
  wordCount: 1840,
  text: 'Prices fell twelve-fold. Latency barely moved.',
};

function validSummary(): ReaderSummary {
  return {
    headline: 'Why the new inference cost curve changes hosting decisions',
    gist: 'Argues the bottleneck moved from price to latency.',
    overview: {
      novel_ideas: ['Latency, not price, now decides where a model runs.'],
      evidence: ['A 12× price drop against a 1.4× latency improvement.'],
      argument: 'Prices fell; latency did not; the hosting decision inverted.',
      who_should_read: 'Anyone choosing between hosted and self-run inference.',
    },
  };
}

/**
 * A stand-in for `Anthropic.Message` carrying only the fields `summarizePost` reads. The full
 * interface requires several `| null` fields a real response always fills; nothing under test
 * looks at them. Copied from `classifier.test.ts` rather than imported — a test file is not a
 * module to depend on, and the two suites must be free to diverge.
 */
function fakeMessage(
  content: unknown[],
  stopReason: Anthropic.StopReason,
  usage?: { input_tokens: number; output_tokens: number },
  stopDetails?: Anthropic.RefusalStopDetails,
): Anthropic.Message {
  return {
    content,
    stop_reason: stopReason,
    usage,
    stop_details: stopDetails,
  } as unknown as Anthropic.Message;
}

function textContent(text: string): unknown[] {
  return [{ type: 'text', text }];
}

function mockCreate(): jest.SpyInstance {
  return jest.spyOn(Anthropic.Messages.prototype, 'create');
}

function sentParams(spy: jest.SpyInstance): Anthropic.MessageCreateParamsNonStreaming {
  const [params] = spy.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
  return params;
}

describe('summarizePost — the request', () => {
  it('sends the configured model, max_tokens, system and user turn', async () => {
    const spy = mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(validSummary())), 'end_turn'),
    );

    await summarizePost(post, config);

    const request = buildReaderRequest(post);
    const params = sentParams(spy);
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(READER_MAX_TOKENS);
    expect(READER_MAX_TOKENS).toBe(4096);
    expect(params.system).toBe(request.system);
    expect(params.messages).toEqual([{ role: 'user', content: request.user }]);
  });

  it('switches thinking off explicitly — Sonnet 5 thinks adaptively when the key is omitted', async () => {
    const spy = mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(validSummary())), 'end_turn'),
    );

    await summarizePost(post, config);

    expect(sentParams(spy).thinking).toEqual({ type: 'disabled' });
  });

  it('sends output_config with BOTH effort and the reader schema', async () => {
    const spy = mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(validSummary())), 'end_turn'),
    );

    await summarizePost(post, config);

    expect(sentParams(spy).output_config).toEqual({
      effort: 'medium',
      format: { type: 'json_schema', schema: READER_SUMMARY_SCHEMA },
    });
  });

  it('truncates the post text at the model-input cap before sending', async () => {
    const spy = mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(validSummary())), 'end_turn'),
    );

    await summarizePost({ ...post, text: 'a'.repeat(READER_MODEL_INPUT_CHARS + 2000) }, config);

    const content = sentParams(spy).messages[0]?.content;
    expect(typeof content).toBe('string');
    const sent = typeof content === 'string' ? content : '';
    expect(sent.split('--- post text ---\n', 2)[1]).toHaveLength(READER_MODEL_INPUT_CHARS);
  });

  it('builds the client with the reader timeout and one retry', async () => {
    const spy = mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(validSummary())), 'end_turn'),
    );

    await summarizePost(post, config);

    // The options live on the client, not the params — assert the constants the client is built
    // from, which is what a future edit would have to change to break the budget arithmetic.
    expect(READER_REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(READER_MAX_RETRIES).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('summarizePost — reading a response', () => {
  it('returns done with the parsed summary', async () => {
    const summary = validSummary();
    mockCreate().mockResolvedValue(fakeMessage(textContent(JSON.stringify(summary)), 'end_turn'));

    await expect(summarizePost(post, config)).resolves.toEqual({ kind: 'done', summary });
  });

  it('trims each bullet list to six on the way out', async () => {
    const summary = validSummary();
    summary.overview.novel_ideas = Array.from({ length: 9 }, (_, i) => `idea ${String(i)}`);
    summary.overview.evidence = Array.from({ length: 8 }, (_, i) => `fact ${String(i)}`);
    mockCreate().mockResolvedValue(fakeMessage(textContent(JSON.stringify(summary)), 'end_turn'));

    const outcome = await summarizePost(post, config);

    expect(outcome.kind).toBe('done');
    if (outcome.kind !== 'done') throw new Error('expected done');
    expect(outcome.summary.overview.novel_ideas).toHaveLength(6);
    expect(outcome.summary.overview.evidence).toHaveLength(6);
  });

  it('maps stop_reason "refusal" to refused, without reading content', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('not read'), 'refusal'));

    await expect(summarizePost(post, config)).resolves.toEqual({ kind: 'refused' });
  });

  it("carries stop_details.explanation as the refused outcome's explanation", async () => {
    mockCreate().mockResolvedValue(
      fakeMessage(textContent('not read'), 'refusal', undefined, {
        category: 'general_harms',
        explanation: 'This post walks through exploit chains in operational detail.',
        type: 'refusal',
      }),
    );

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'refused',
      explanation: 'This post walks through exploit chains in operational detail.',
    });
  });

  it('omits the explanation key when stop_details carries none', async () => {
    mockCreate().mockResolvedValue(
      fakeMessage(textContent('not read'), 'refusal', undefined, {
        category: WIRE_NULL as Anthropic.RefusalStopDetails['category'],
        explanation: WIRE_NULL as Anthropic.RefusalStopDetails['explanation'],
        type: 'refusal',
      }),
    );

    await expect(summarizePost(post, config)).resolves.toEqual({ kind: 'refused' });
  });

  it('maps stop_reason "max_tokens" to a counted max_tokens failure', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('{"headl'), 'max_tokens'));

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'max_tokens',
    });
  });

  it('maps a response with no text block to a counted unparseable failure', async () => {
    mockCreate().mockResolvedValue(fakeMessage([], 'end_turn'));

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'unparseable',
    });
  });

  it('maps a non-JSON body to a counted unparseable failure', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('not json at all'), 'end_turn'));

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'unparseable',
    });
  });

  it('maps a parsed body missing a key to a counted schema failure', async () => {
    const summary = validSummary();
    const body = JSON.stringify({ headline: summary.headline, overview: summary.overview });
    mockCreate().mockResolvedValue(fakeMessage(textContent(body), 'end_turn'));

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'schema',
    });
  });

  it('maps a non-string bullet to a counted schema failure', async () => {
    const summary = validSummary();
    const body = JSON.stringify({
      ...summary,
      overview: { ...summary.overview, novel_ideas: ['fine', 7] },
    });
    mockCreate().mockResolvedValue(fakeMessage(textContent(body), 'end_turn'));

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'schema',
    });
  });

  it('maps a bare JSON null body to a counted schema failure rather than throwing', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('null'), 'end_turn'));

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'schema',
    });
  });
});

describe('summarizePost — usage', () => {
  it('passes the token counts through on a successful summary', async () => {
    const summary = validSummary();
    mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(summary)), 'end_turn', {
        input_tokens: 9123,
        output_tokens: 1440,
      }),
    );

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'done',
      summary,
      usage: { inputTokens: 9123, outputTokens: 1440 },
    });
  });

  it('passes the token counts through on a refusal and on a truncation', async () => {
    const usage = { input_tokens: 10, output_tokens: 20 };
    mockCreate().mockResolvedValue(fakeMessage(textContent('x'), 'refusal', usage));
    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'refused',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    mockCreate().mockResolvedValue(fakeMessage(textContent('x'), 'max_tokens', usage));
    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'counted',
      error: 'max_tokens',
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it('omits the key entirely when the response carried no usage', async () => {
    mockCreate().mockResolvedValue(
      fakeMessage(textContent(JSON.stringify(validSummary())), 'end_turn'),
    );

    const outcome = await summarizePost(post, config);

    expect(outcome).not.toHaveProperty('usage');
  });
});

/** An `APIError` of the given status, as the SDK itself would construct one. */
function apiError(status: number, message: string): unknown {
  return Anthropic.APIError.generate(status, { error: { message } }, message, new Headers());
}

describe('summarizePost — errors thrown by the SDK', () => {
  it('maps AuthenticationError (401) to systemic credentials', async () => {
    const error = apiError(401, 'invalid x-api-key');
    expect(error).toBeInstanceOf(Anthropic.AuthenticationError);
    mockCreate().mockRejectedValue(error);

    await expect(summarizePost(post, config)).resolves.toMatchObject({
      kind: 'systemic',
      reason: 'credentials',
    });
  });

  it('maps PermissionDeniedError (403) to systemic credentials', async () => {
    const error = apiError(403, 'forbidden');
    expect(error).toBeInstanceOf(Anthropic.PermissionDeniedError);
    mockCreate().mockRejectedValue(error);

    await expect(summarizePost(post, config)).resolves.toMatchObject({
      kind: 'systemic',
      reason: 'credentials',
    });
  });

  it('maps BadRequestError (400) to systemic bad_request, NOT counted', async () => {
    // The distinction the tick's abort hangs on: a 400 is identical for every post — a model that
    // rejects `thinking: disabled`, say — so counting it per post would fail the whole backlog.
    const error = apiError(400, 'thinking.disabled is not supported by claude-fable-5');
    expect(error).toBeInstanceOf(Anthropic.BadRequestError);
    mockCreate().mockRejectedValue(error);

    await expect(summarizePost(post, config)).resolves.toMatchObject({
      kind: 'systemic',
      reason: 'bad_request',
      error: expect.stringContaining('fable') as string,
    });
  });

  it('maps a 429 to an uncounted failure', async () => {
    mockCreate().mockRejectedValue(apiError(429, 'rate limited'));

    await expect(summarizePost(post, config)).resolves.toMatchObject({ kind: 'uncounted' });
  });

  it('maps a 500 to an uncounted failure', async () => {
    mockCreate().mockRejectedValue(apiError(500, 'oops'));

    await expect(summarizePost(post, config)).resolves.toMatchObject({ kind: 'uncounted' });
  });

  it('maps a timeout and a raw network error to uncounted failures', async () => {
    mockCreate().mockRejectedValue(new Anthropic.APIConnectionTimeoutError({}));
    await expect(summarizePost(post, config)).resolves.toMatchObject({ kind: 'uncounted' });

    mockCreate().mockRejectedValue(new TypeError('fetch failed'));
    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'uncounted',
      error: 'fetch failed',
    });
  });

  it('resolves rather than rejects when the SDK throws a non-Error value', async () => {
    mockCreate().mockRejectedValue('a string, not an Error');

    await expect(summarizePost(post, config)).resolves.toEqual({
      kind: 'uncounted',
      error: 'a string, not an Error',
    });
  });
});

describe('summarizePost — missing credentials', () => {
  it('returns systemic credentials without sending a request', async () => {
    const spy = mockCreate();

    const outcome = await summarizePost(post, { apiKey: '', model: 'claude-sonnet-5' });

    expect(outcome).toMatchObject({ kind: 'systemic', reason: 'credentials' });
    expect(spy).not.toHaveBeenCalled();
  });
});
