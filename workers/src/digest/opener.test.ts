import Anthropic from '@anthropic-ai/sdk';

import {
  OPENER_CAP,
  OPENER_MAX_RETRIES,
  OPENER_MAX_TOKENS,
  OPENER_SCHEMA,
  OPENER_SYSTEM,
  OPENER_TIMEOUT_MS,
  type OpenerInput,
  writeOpener,
} from './opener';

const env = { ANTHROPIC_API_KEY: 'sk-ant-test-key', DIGEST_MODEL: 'claude-sonnet-5' };

const input: OpenerInput = {
  date: 'Saturday, Nov 7',
  plan: { theme: 'Finish what slipped', lines: [{ label: 'Run', text: 'Long run (8)' }] },
  due: [{ title: 'Send RealPlay October invoice', label: '2 days late' }],
  due_overflow: 0,
  comms: {
    counts: { asap: 1, today: 0, whenever: 6 },
    asks: [{ tier: 'asap', sender: 'Dana', ask: 'Can you confirm Thursday’s rehearsal time?' }],
  },
  reader_waiting: 12,
};

/** Only the fields `writeOpener` reads; the rest of `Anthropic.Message` is irrelevant here. */
function fakeMessage(content: unknown[], stopReason: Anthropic.StopReason): Anthropic.Message {
  return { content, stop_reason: stopReason } as unknown as Anthropic.Message;
}

const reply = (body: unknown, stop: Anthropic.StopReason = 'end_turn'): Anthropic.Message =>
  fakeMessage(
    [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    stop,
  );

const mockCreate = (): jest.SpyInstance => jest.spyOn(Anthropic.Messages.prototype, 'create');

/** A typed SDK error, built the way the client builds one from a response. */
function apiError(status: number): Error {
  return Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', new Headers());
}

describe('writeOpener — the request', () => {
  it('sends the model, the schema, the system prompt and the facts as JSON', async () => {
    const spy = mockCreate().mockResolvedValue(reply({ opener: 'Invoice first.' }));

    await writeOpener(env, input);

    const [params, options] = spy.mock.calls[0] as [
      Anthropic.MessageCreateParamsNonStreaming,
      unknown,
    ];
    expect(params).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: OPENER_MAX_TOKENS,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OPENER_SCHEMA } },
      system: OPENER_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    expect(options).toBeUndefined();
    expect(OPENER_MAX_TOKENS).toBe(400);
    // One retry inside a ~20 s total wait for the opener.
    expect(OPENER_TIMEOUT_MS * (OPENER_MAX_RETRIES + 1)).toBeLessThanOrEqual(20_000);
    expect(OPENER_MAX_RETRIES).toBe(1);
  });

  it('tells the model to use only the given facts and never to restate the lists', () => {
    expect(OPENER_SYSTEM).toMatch(/only the facts/i);
    expect(OPENER_SYSTEM).toMatch(/never name a task, person or article that is not in the input/i);
    expect(OPENER_SYSTEM).toMatch(/do not restate counts/i);
    expect(OPENER_SYSTEM).toMatch(/no greeting/i);
  });
});

describe('writeOpener — the answer', () => {
  it('returns the trimmed opener', async () => {
    mockCreate().mockResolvedValue(reply({ opener: '  Invoice first, then Dana.  ' }));
    await expect(writeOpener(env, input)).resolves.toEqual({
      opener: 'Invoice first, then Dana.',
    });
  });

  it('caps a long opener in graphemes, never splitting an emoji', async () => {
    mockCreate().mockResolvedValue(reply({ opener: '🏃'.repeat(OPENER_CAP + 50) }));
    const outcome = await writeOpener(env, input);
    expect(outcome).toEqual({ opener: `${'🏃'.repeat(OPENER_CAP - 1)}…` });
  });
});

describe('writeOpener — every failure is "unavailable", never a throw', () => {
  it('needs no request when there is no key', async () => {
    const spy = mockCreate();
    await expect(writeOpener({ DIGEST_MODEL: 'm' }, input)).resolves.toEqual({
      unavailable: 'ANTHROPIC_API_KEY is not set',
    });
    await expect(
      writeOpener({ ANTHROPIC_API_KEY: ' ', DIGEST_MODEL: 'm' }, input),
    ).resolves.toEqual({ unavailable: 'ANTHROPIC_API_KEY is not set' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('needs no request when there is no model', async () => {
    const spy = mockCreate();
    await expect(writeOpener({ ANTHROPIC_API_KEY: 'k' }, input)).resolves.toEqual({
      unavailable: 'DIGEST_MODEL is not set',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([401, 400, 429, 500, 529])('maps an HTTP %i to unavailable', async (code) => {
    mockCreate().mockRejectedValue(apiError(code));
    const outcome = await writeOpener(env, input);
    expect(outcome).toHaveProperty('unavailable');
    expect('opener' in outcome).toBe(false);
  });

  it('maps a timeout to unavailable', async () => {
    mockCreate().mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    await expect(writeOpener(env, input)).resolves.toEqual({
      unavailable: 'Request timed out.',
    });
  });

  it('maps a refusal to unavailable', async () => {
    mockCreate().mockResolvedValue(reply({ opener: 'x' }, 'refusal'));
    await expect(writeOpener(env, input)).resolves.toEqual({ unavailable: 'refusal' });
  });

  it('maps a truncation to unavailable', async () => {
    mockCreate().mockResolvedValue(reply('{"opener": "a', 'max_tokens'));
    await expect(writeOpener(env, input)).resolves.toEqual({ unavailable: 'max_tokens' });
  });

  it.each([
    ['no text block', fakeMessage([], 'end_turn'), 'no text'],
    ['invalid JSON', reply('not json'), 'unparseable'],
    ['the wrong shape', reply({ summary: 'x' }), 'schema'],
    ['a non-string opener', reply({ opener: 3 }), 'schema'],
    ['a blank opener', reply({ opener: ' '.repeat(3) }), 'empty'],
  ])('maps %s to unavailable', async (_what, message, reason) => {
    mockCreate().mockResolvedValue(message);
    await expect(writeOpener(env, input)).resolves.toEqual({ unavailable: reason });
  });
});
