import Anthropic from '@anthropic-ai/sdk';

import { type ClassifierEnv, MAX_TOKENS, classify } from './classifier';
import type { ClassifyRequest } from './prompt';

const env: ClassifierEnv = {
  ANTHROPIC_API_KEY: 'sk-ant-test-key',
  CLASSIFIER_MODEL: 'claude-haiku-4-5',
};

const request: ClassifyRequest = {
  system: 'Classify this Inbox item.',
  user: 'title: buy milk',
  schema: {
    type: 'object',
    properties: {
      item_type: { type: 'string', enum: ['task', 'code'] },
    },
    required: ['item_type'],
  },
};

/**
 * A stand-in for `Anthropic.Message` carrying only the fields `classify` reads
 * (`content`, `stop_reason`). The full interface requires several `| null` fields that a real
 * response always fills, but nothing under test looks at them — a genuine value of the right
 * shape isn't needed to pin the behavior this module owns.
 */
function fakeMessage(content: unknown[], stopReason: Anthropic.StopReason): Anthropic.Message {
  return { content, stop_reason: stopReason } as unknown as Anthropic.Message;
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

describe('classify — the request', () => {
  it('carries the model, max_tokens, system, user and schema verbatim', async () => {
    const spy = mockCreate().mockResolvedValue(fakeMessage(textContent('{}'), 'end_turn'));

    await classify(env, request);

    const params = sentParams(spy);
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.max_tokens).toBe(MAX_TOKENS);
    expect(params.system).toBe(request.system);
    expect(params.messages).toEqual([{ role: 'user', content: request.user }]);
    expect(params.output_config?.format).toEqual({ type: 'json_schema', schema: request.schema });
  });

  it('carries no thinking key and no output_config.effort key', async () => {
    const spy = mockCreate().mockResolvedValue(fakeMessage(textContent('{}'), 'end_turn'));

    await classify(env, request);

    const params = sentParams(spy);
    expect(params).not.toHaveProperty('thinking');
    expect(params.output_config).not.toHaveProperty('effort');
  });
});

describe('classify — reading a response', () => {
  it('parses a well-formed response into a Verdict', async () => {
    const body = JSON.stringify({
      item_type: 'task',
      priority: 'high',
      due_date: '2026-08-10',
      folder_id: 'folder-1',
      intended_project_id: 'proj-1',
      intended_epic_id: 'epic-1',
    });
    mockCreate().mockResolvedValue(fakeMessage(textContent(body), 'end_turn'));

    await expect(classify(env, request)).resolves.toEqual({
      ok: {
        item_type: 'task',
        priority: 'high',
        due_date: '2026-08-10',
        folder_id: 'folder-1',
        intended_project_id: 'proj-1',
        intended_epic_id: 'epic-1',
      },
    });
  });

  it('parses a fully-null response into a fully-abstaining Verdict — a legal answer, not a failure', async () => {
    // Written as raw JSON text (not a JS object literal) so this stays "null" the JSON value,
    // never the `null` literal the project's lint rules forbid in source.
    const body =
      '{"item_type":null,"priority":null,"due_date":null,"folder_id":null,"intended_project_id":null,"intended_epic_id":null}';
    mockCreate().mockResolvedValue(fakeMessage(textContent(body), 'end_turn'));

    await expect(classify(env, request)).resolves.toEqual({
      ok: {
        item_type: undefined,
        priority: undefined,
        due_date: undefined,
        folder_id: undefined,
        intended_project_id: undefined,
        intended_epic_id: undefined,
      },
    });
  });

  it('maps stop_reason "refusal" to a refusal failure without reading content', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('not read'), 'refusal'));

    await expect(classify(env, request)).resolves.toEqual({ failed: { reason: 'refusal' } });
  });

  it('maps stop_reason "max_tokens" to a truncated failure', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('{"item_typ'), 'max_tokens'));

    await expect(classify(env, request)).resolves.toEqual({ failed: { reason: 'truncated' } });
  });

  it('maps a non-JSON body to an unparseable failure', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('not json at all'), 'end_turn'));

    const outcome = await classify(env, request);
    expect(outcome).toMatchObject({
      failed: {
        reason: 'unparseable',
        detail: expect.stringContaining('not json at all') as string,
      },
    });
  });

  it('maps a response with no text block to an unparseable failure', async () => {
    mockCreate().mockResolvedValue(fakeMessage([], 'end_turn'));

    const outcome = await classify(env, request);
    expect(outcome).toMatchObject({
      failed: { reason: 'unparseable', detail: expect.stringContaining('no text block') as string },
    });
  });
});

describe('classify — errors thrown by the SDK', () => {
  it('maps AuthenticationError (401) to a credentials failure', async () => {
    const error = Anthropic.APIError.generate(
      401,
      { error: { message: 'invalid x-api-key' } },
      'invalid x-api-key',
      new Headers(),
    );
    expect(error).toBeInstanceOf(Anthropic.AuthenticationError);
    mockCreate().mockRejectedValue(error);

    const outcome = await classify(env, request);
    expect(outcome).toMatchObject({ failed: { reason: 'credentials' } });
  });

  it('maps PermissionDeniedError (403) to a credentials failure', async () => {
    const error = Anthropic.APIError.generate(
      403,
      { error: { message: 'forbidden' } },
      'forbidden',
      new Headers(),
    );
    expect(error).toBeInstanceOf(Anthropic.PermissionDeniedError);
    mockCreate().mockRejectedValue(error);

    const outcome = await classify(env, request);
    expect(outcome).toMatchObject({ failed: { reason: 'credentials' } });
  });

  it('maps a 429 RateLimitError to a transport failure', async () => {
    const error = Anthropic.APIError.generate(
      429,
      { error: { message: 'rate limited' } },
      'rate limited',
      new Headers(),
    );
    mockCreate().mockRejectedValue(error);

    const outcome = await classify(env, request);
    expect(outcome).toMatchObject({ failed: { reason: 'transport' } });
  });

  it('maps a 500 InternalServerError to a transport failure', async () => {
    const error = Anthropic.APIError.generate(
      500,
      { error: { message: 'oops' } },
      'oops',
      new Headers(),
    );
    mockCreate().mockRejectedValue(error);

    const outcome = await classify(env, request);
    expect(outcome).toMatchObject({ failed: { reason: 'transport' } });
  });

  it('maps a raw network error to a transport failure', async () => {
    mockCreate().mockRejectedValue(new TypeError('fetch failed'));

    await expect(classify(env, request)).resolves.toEqual({
      failed: { reason: 'transport', detail: 'fetch failed' },
    });
  });
});

describe('classify — missing credentials', () => {
  it('maps a missing ANTHROPIC_API_KEY to a credentials failure without sending a request', async () => {
    const spy = mockCreate();
    const envWithoutKey: ClassifierEnv = { CLASSIFIER_MODEL: 'claude-haiku-4-5' };

    const outcome = await classify(envWithoutKey, request);

    expect(outcome).toMatchObject({ failed: { reason: 'credentials' } });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('classify — never throws', () => {
  it('resolves rather than rejects even when the SDK rejects with a non-Error value', async () => {
    mockCreate().mockRejectedValue('a string, not an Error');

    await expect(classify(env, request)).resolves.toEqual({
      failed: { reason: 'transport', detail: 'a string, not an Error' },
    });
  });

  it('resolves rather than rejects when the response body is unparseable garbage', async () => {
    mockCreate().mockResolvedValue(fakeMessage(textContent('{{{{'), 'end_turn'));

    await expect(classify(env, request)).resolves.toMatchObject({
      failed: { reason: 'unparseable' },
    });
  });
});
