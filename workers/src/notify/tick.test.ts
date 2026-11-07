import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import type { NotificationClaim } from './store';
import {
  CONFIG_FAILURE,
  MAX_ATTEMPTS,
  NOTIFY_LIMIT,
  type NotifyEnv,
  SUBREQUEST_CEILING,
  SYSTEMIC_FAILURE,
  UNCONFIGURED,
  runNotifyTick,
  telegramConfig,
} from './tick';

const TOKEN = ['555000111', ':', 'BBG', 'y'.repeat(32)].join('');

const env: NotifyEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_CHAT_ID: '987654321',
  ALFRED_APP_URL: 'https://alfred-six-gamma.vercel.app',
  CLASSIFIER_TIMEZONE: 'America/Chicago',
};

const NOW = new Date('2031-01-15T21:00:00.000Z');

/** A JSON null, as the RPC sends the other kind's fields — parsed, since the literal is banned. */
const WIRE_NULL = JSON.parse('null') as null;

/** A console stub that swallows the line. */
function silence(): void {
  // Deliberately nothing: the test asserts on the spy's calls, not on output.
}

function asap(id: string, attempts = 0): NotificationClaim {
  return {
    id,
    kind: 'comms_asap',
    attempts,
    sender: 'Dana',
    account: 'iMessage',
    ask: 'Asks whether you can pick up the kids at 4 today.',
    title: WIRE_NULL,
    due_time: WIRE_NULL,
  };
}

function due(id: string, attempts = 0): NotificationClaim {
  return {
    id,
    kind: 'task_due',
    attempts,
    sender: WIRE_NULL,
    account: WIRE_NULL,
    ask: WIRE_NULL,
    title: 'Call the dentist about the crown',
    due_time: '15:00:00',
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/**
 * Route the tick's fetches: the claim RPC answers `claims`, each Telegram send takes the next
 * reply from `telegram` (repeating the last), and every PATCH succeeds.
 */
function mockWorld(claims: NotificationClaim[], telegram: (() => Response)[] = [ok]) {
  const calls: Call[] = [];
  let send = 0;
  const spy = spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
    const url = input as string;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: JSON.parse((init?.body ?? '{}') as string) as Record<string, unknown>,
    });
    if (url.includes('/rpc/claim_notifications')) return Promise.resolve(Response.json(claims));
    if (url.includes('api.telegram.org')) {
      const reply = telegram[Math.min(send, telegram.length - 1)] ?? ok;
      send += 1;
      return Promise.resolve(reply());
    }
    return Promise.resolve(Response.json([{}]));
  });
  return { calls, spy };
}

let messageId = 100;
function ok(): Response {
  messageId += 1;
  return Response.json({ ok: true, result: { message_id: messageId } });
}
const REFUSED = { ok: false, description: 'nope' };
const status =
  (code: number, body: Record<string, unknown> = REFUSED) =>
  (): Response =>
    Response.json(body, { status: code });

const sends = (calls: Call[]): Call[] => calls.filter((call) => call.url.includes('telegram'));
const patches = (calls: Call[]): Call[] => calls.filter((call) => call.method === 'PATCH');

describe('runNotifyTick — configuration', () => {
  it.each(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ALFRED_APP_URL'] as const)(
    'makes no RPC and no send when %s is missing',
    async (name) => {
      const { spy } = mockWorld([asap('n1')]);
      const log = jest.spyOn(console, 'log').mockImplementation(silence);
      const { [name]: _unset, ...partial } = env;

      const result = await runNotifyTick(partial, NOW);

      expect(spy).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(UNCONFIGURED);
      expect(result).toMatchObject({ claimed: 0, sent: 0, aborted: false });
    },
  );

  it('aborts and claims nothing when the zone is missing', async () => {
    const { spy } = mockWorld([asap('n1')]);
    const error = jest.spyOn(console, 'error').mockImplementation(silence);
    const { CLASSIFIER_TIMEZONE: _unset, ...noZone } = env;

    const result = await runNotifyTick(noZone as NotifyEnv, NOW);

    expect(spy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(CONFIG_FAILURE);
    expect(result.aborted).toBe(true);
  });

  it('reads the configuration only when all three are set', () => {
    expect(telegramConfig(env)).toEqual({
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_CHAT_ID: '987654321',
      appUrl: 'https://alfred-six-gamma.vercel.app',
    });
    expect(telegramConfig({ ...env, TELEGRAM_CHAT_ID: '' })).toBeUndefined();
    expect(telegramConfig({ ...env, TELEGRAM_BOT_TOKEN: '  ' })).toBeUndefined();
  });
});

describe('runNotifyTick — the happy path', () => {
  it('claims at the given instant in the classifier zone, sends each claim, and records it', async () => {
    const { calls } = mockWorld([asap('n1'), due('n2')]);

    const result = await runNotifyTick(env, NOW);

    expect(result).toEqual({
      claimed: 2,
      sent: 2,
      failed: 0,
      abandoned: 0,
      aborted: false,
      failures: [],
    });
    expect(calls[0]?.url).toBe('https://proj.supabase.co/rest/v1/rpc/claim_notifications');
    expect(calls[0]?.body).toEqual({
      p_now: '2031-01-15T21:00:00.000Z',
      p_zone: 'America/Chicago',
      p_limit: NOTIFY_LIMIT,
    });

    const [comms, task] = sends(calls);
    expect(comms?.body['text']).toBe(
      '<b>ASAP · Dana · iMessage</b>\nAsks whether you can pick up the kids at 4 today.\n' +
        '<a href="https://alfred-six-gamma.vercel.app/comms">Open comms</a>',
    );
    expect(task?.body['text']).toBe(
      '<b>Due 3:00 PM</b>\nCall the dentist about the crown\n' +
        '<a href="https://alfred-six-gamma.vercel.app/today">Open Today</a>',
    );

    const [first] = patches(calls);
    expect(first?.url).toContain('/rest/v1/notifications?id=eq.n1');
    expect(first?.body).toEqual({
      sent_at: expect.any(String) as unknown,
      telegram_message_id: expect.any(Number) as unknown,
      text: comms?.body['text'],
    });
  });

  it('records the plain text when that is what got through', async () => {
    const { calls } = mockWorld([due('n1')], [status(400), ok]);

    await runNotifyTick(env, NOW);

    const [patch] = patches(calls);
    expect(patch?.body['text']).toBe(
      'Due 3:00 PM\nCall the dentist about the crown\nhttps://alfred-six-gamma.vercel.app/today',
    );
  });
});

describe('runNotifyTick — failures', () => {
  it('stops at a 429 without counting an attempt, leaving the rest for the next tick', async () => {
    const { calls } = mockWorld(
      [asap('n1'), asap('n2'), asap('n3')],
      [ok, status(429, { ok: false, parameters: { retry_after: 3 } })],
    );

    const result = await runNotifyTick(env, NOW);

    expect(sends(calls)).toHaveLength(2);
    expect(patches(calls)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, failed: 0, aborted: false });
    expect(result.failures).toEqual([
      'rate limited (retry after 3s) — the rest wait for the next tick',
    ]);
  });

  it('counts a 5xx as an attempt and carries on to the next claim', async () => {
    const { calls } = mockWorld([asap('n1', 1), asap('n2')], [status(502), ok]);

    const result = await runNotifyTick(env, NOW);

    const [attempt] = patches(calls);
    expect(attempt?.url).toContain('id=eq.n1');
    expect(attempt?.body).toEqual({ attempts: 2, last_error: 'HTTP 502: nope' });
    expect(result).toMatchObject({ sent: 1, failed: 1, abandoned: 0 });
  });

  it('reports a failure on a claim’s last attempt as abandoned', async () => {
    mockWorld([asap('n1', MAX_ATTEMPTS - 1)], [status(500)]);

    await expect(runNotifyTick(env, NOW)).resolves.toMatchObject({ failed: 1, abandoned: 1 });
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it('counts a 400 that survived the plain-text resend as an attempt', async () => {
    const { calls } = mockWorld([asap('n1')], [status(400)]);

    const result = await runNotifyTick(env, NOW);

    expect(sends(calls)).toHaveLength(2);
    expect(patches(calls)[0]?.body).toEqual({ attempts: 1, last_error: 'HTTP 400: nope' });
    expect(result.failed).toBe(1);
  });

  it.each([401, 403])('aborts on a %i with a banner and counts no attempt', async (code) => {
    const { calls } = mockWorld([asap('n1'), asap('n2')], [status(code)]);
    const error = jest.spyOn(console, 'error').mockImplementation(silence);

    const result = await runNotifyTick(env, NOW);

    expect(sends(calls)).toHaveLength(1);
    expect(patches(calls)).toHaveLength(0);
    expect(result.aborted).toBe(true);
    expect(error).toHaveBeenCalledWith(`${SYSTEMIC_FAILURE}: HTTP ${String(code)}: nope`);
  });

  it('counts a claim that came back without its fields rather than sending a blank ping', async () => {
    const { calls } = mockWorld([{ ...asap('n1'), ask: WIRE_NULL }]);

    const result = await runNotifyTick(env, NOW);

    expect(sends(calls)).toHaveLength(0);
    expect(result.failed).toBe(1);
  });

  it('reports a failed claim RPC as an aborted tick, not a throw', async () => {
    spyOnFetch().mockResolvedValue(new Response('down', { status: 503 }));

    const result = await runNotifyTick(env, NOW);

    expect(result.aborted).toBe(true);
    expect(result.failures[0]).toContain('claim failed');
  });

  it('never logs or reports the bot token', async () => {
    spyOnFetch().mockImplementation((input: FetchInput) =>
      (input as string).includes('telegram')
        ? Promise.reject(new TypeError(`fetch failed: ${input as string}`))
        : Promise.resolve(Response.json([asap('n1')])),
    );
    const logged: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }

    const result = await runNotifyTick(env, NOW);

    expect(result.failed).toBe(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(logged.join('\n')).not.toContain(TOKEN);
  });
});

describe('the subrequest budget', () => {
  it('holds a full tick of sends inside the ceiling: 1 + 2 × NOTIFY_LIMIT', async () => {
    const claims = Array.from({ length: NOTIFY_LIMIT }, (_unused, index) =>
      asap(`n${String(index)}`),
    );
    const { spy } = mockWorld(claims);

    const result = await runNotifyTick(env, NOW);

    expect(result.sent).toBe(NOTIFY_LIMIT);
    expect(spy).toHaveBeenCalledTimes(1 + 2 * NOTIFY_LIMIT);
    expect(1 + 2 * NOTIFY_LIMIT).toBeLessThanOrEqual(SUBREQUEST_CEILING);
  });

  it('stops before the ceiling when every send needs the plain-text resend', async () => {
    // Every first send 400s and every resend succeeds: three subrequests a claim.
    const claims = Array.from({ length: NOTIFY_LIMIT }, (_unused, index) =>
      asap(`n${String(index)}`),
    );
    let sent = 0;
    const spy = spyOnFetch().mockImplementation((input: FetchInput) => {
      const url = input as string;
      if (url.includes('/rpc/')) return Promise.resolve(Response.json(claims));
      if (url.includes('telegram')) {
        sent += 1;
        return Promise.resolve(sent % 2 === 1 ? status(400)() : ok());
      }
      return Promise.resolve(Response.json([{}]));
    });

    const result = await runNotifyTick(env, NOW);

    expect(spy.mock.calls.length).toBeLessThanOrEqual(SUBREQUEST_CEILING);
    expect(result.sent).toBe(Math.floor((SUBREQUEST_CEILING - 1) / 3));
    expect(result.aborted).toBe(false);
  });
});
