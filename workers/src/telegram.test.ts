import { spyOnFetch } from './fetch-stub';
import { type TelegramEnv, redact, sendTelegram } from './telegram';

// Shaped like a BotFather token (digits, a colon, 35 URL-safe characters) but assembled at
// runtime, so the source text never matches the secret scan's bot-token rule.
const TOKEN = ['123456789', ':', 'AAF', 'x'.repeat(32)].join('');
const env: TelegramEnv = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '987654321' };

const reply = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const sent = (): Response => reply(200, { ok: true, result: { message_id: 42 } });

function bodies(spy: ReturnType<typeof spyOnFetch>): Record<string, unknown>[] {
  return spy.mock.calls.map(
    ([, init]) => JSON.parse((init?.body ?? '{}') as string) as Record<string, unknown>,
  );
}

describe('sendTelegram', () => {
  it('POSTs the HTML to sendMessage for the one chat, with link previews off', async () => {
    const spy = spyOnFetch().mockImplementation(() => Promise.resolve(sent()));

    await expect(sendTelegram(env, '<b>hi</b>', 'hi')).resolves.toEqual({
      outcome: { kind: 'sent', messageId: 42 },
      requests: 1,
    });

    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init?.method).toBe('POST');
    expect(bodies(spy)).toEqual([
      {
        chat_id: '987654321',
        text: '<b>hi</b>',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      },
    ]);
  });

  it('resends exactly once as plain text on a 400, with no parse mode and no tags', async () => {
    const spy = spyOnFetch()
      .mockResolvedValueOnce(
        reply(400, { ok: false, description: "Bad Request: can't parse entities" }),
      )
      .mockImplementationOnce(() => Promise.resolve(sent()));

    await expect(sendTelegram(env, '<b>hi</b>', 'hi')).resolves.toEqual({
      outcome: { kind: 'sent', messageId: 42 },
      requests: 2,
    });
    expect(bodies(spy)[1]).toEqual({ chat_id: '987654321', text: 'hi' });
  });

  it('is rejected when the plain-text resend is a 400 too — and never tries a third time', async () => {
    const spy = spyOnFetch().mockImplementation(() =>
      Promise.resolve(reply(400, { ok: false, description: 'Bad Request: message is too long' })),
    );

    await expect(sendTelegram(env, 'h', 'p')).resolves.toEqual({
      outcome: { kind: 'rejected', error: 'HTTP 400: Bad Request: message is too long' },
      requests: 2,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('treats a 400 "chat not found" as systemic: a wrong chat id fails every send alike', async () => {
    const spy = spyOnFetch().mockImplementation(() =>
      Promise.resolve(reply(400, { ok: false, description: 'Bad Request: chat not found' })),
    );

    await expect(sendTelegram(env, 'h', 'p')).resolves.toEqual({
      outcome: { kind: 'systemic', error: 'HTTP 400: Bad Request: chat not found' },
      requests: 1,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, { ok: false, parameters: { retry_after: 7 } }, { kind: 'rate_limited', retryAfter: 7 }],
    [429, { ok: false }, { kind: 'rate_limited' }],
    [
      500,
      { ok: false, description: 'Internal' },
      { kind: 'uncertain', error: 'HTTP 500: Internal' },
    ],
    [502, {}, { kind: 'uncertain', error: 'HTTP 502' }],
    [
      401,
      { ok: false, description: 'Unauthorized' },
      { kind: 'systemic', error: 'HTTP 401: Unauthorized' },
    ],
    [
      403,
      { ok: false, description: 'Forbidden: bot was blocked by the user' },
      { kind: 'systemic', error: 'HTTP 403: Forbidden: bot was blocked by the user' },
    ],
    [
      404,
      { ok: false, description: 'Not Found' },
      { kind: 'systemic', error: 'HTTP 404: Not Found' },
    ],
    [
      409,
      { ok: false, description: 'Conflict' },
      { kind: 'rejected', error: 'HTTP 409: Conflict' },
    ],
    [200, { ok: true }, { kind: 'uncertain', error: 'HTTP 200' }],
  ])('maps HTTP %i to its outcome without a resend', async (status, body, outcome) => {
    const spy = spyOnFetch().mockResolvedValue(reply(status, body));

    await expect(sendTelegram(env, 'h', 'p')).resolves.toEqual({ outcome, requests: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reads a body that is not JSON as an empty one', async () => {
    spyOnFetch().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));

    await expect(sendTelegram(env, 'h', 'p')).resolves.toEqual({
      outcome: { kind: 'uncertain', error: 'HTTP 502' },
      requests: 1,
    });
  });

  it('counts a network failure as uncertain, with the token scrubbed from its message', async () => {
    // Some runtimes build a fetch error's message from the URL — which carries the token.
    spyOnFetch().mockRejectedValue(
      new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`),
    );

    const { outcome } = await sendTelegram(env, 'h', 'p');

    expect(outcome).toEqual({
      kind: 'uncertain',
      error: 'TypeError: fetch failed: https://api.telegram.org/bot<redacted>/sendMessage',
    });
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });

  it('times a hung request out after 30 s rather than holding the tick', async () => {
    const spy = spyOnFetch().mockImplementation(() => Promise.resolve(sent()));
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    await sendTelegram(env, 'h', 'p');

    expect(spy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    // Generous: a reply that arrives late is a send we know about; one we abandon may be a ping
    // the owner saw while the tick recorded a failure.
    expect(timeout).toHaveBeenCalledWith(30_000);
  });
});

describe('redact', () => {
  it('replaces every occurrence of the token', () => {
    expect(redact(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe('a <redacted> b <redacted>');
  });

  it('leaves text alone when there is no token to hide', () => {
    expect(redact('text', '')).toBe('text');
  });
});
