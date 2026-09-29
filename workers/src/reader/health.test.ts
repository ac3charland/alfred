import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { recordInstapaperHealth, recordRunError, recordRunStart, recordRunSuccess } from './health';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-09-18T11:45:00.000Z');

/** A `console.error` stand-in with a body, since an empty arrow function is a lint error. */
function NOTHING(): void {
  return undefined;
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function harness(response: () => Response): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
    calls.push({
      url: input as string,
      method: init?.method ?? 'GET',
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    return Promise.resolve(response());
  });
  return calls;
}

describe('the reader health writers', () => {
  it('patches the singleton rather than inserting it', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunStart(env, NOW);

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toContain('/reader_health?id=eq.1');
    expect(calls[0]?.body).toEqual({ last_run_at: NOW.toISOString() });
  });

  it('stamps last_success_at only through recordRunSuccess', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunSuccess(env, NOW);

    expect(calls[0]?.body).toEqual({ last_success_at: NOW.toISOString() });
  });

  it('never touches last_success_at when recording an error', async () => {
    // That column answers "is this still working". Moving it here would paint a dead module
    // green — the one reading the health row exists to prevent.
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunError(env, NOW, 'READER_MODEL is not set');

    expect(calls[0]?.body).toEqual({
      last_error: 'READER_MODEL is not set',
      last_error_at: NOW.toISOString(),
    });
  });

  it.each([
    ['recordRunStart', recordRunStart],
    ['recordRunSuccess', recordRunSuccess],
  ])('%s swallows a refused write rather than taking the tick down', async (_name, writer) => {
    const logged = jest.spyOn(console, 'error').mockImplementation(NOTHING);
    harness(() => new Response('permission denied', { status: 403 }));

    await expect(writer(env, NOW)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });

  it('swallows a refused error write, so a failure to record a failure cannot replace it', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(NOTHING);
    harness(() => new Response('permission denied', { status: 403 }));

    await expect(recordRunError(env, NOW, 'gmail is down')).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });

  it('swallows a thrown fetch too — an exhausted subrequest budget is not a typed failure', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(NOTHING);
    spyOnFetch().mockRejectedValue(new Error('Too many subrequests by single Worker invocation'));

    await expect(recordRunStart(env, NOW)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });
});

describe('the ceiling stamp', () => {
  it('a partial ceiling drops its undefined keys from the patch body', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunStart(env, NOW, { daily_cap: 30 });

    expect(calls[0]?.body).toEqual({ last_run_at: NOW.toISOString(), daily_cap: 30 });
  });

  it('rides the success write as the cap, the count and the day it was counted over', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunSuccess(env, NOW, { daily_cap: 30, calls_today: 9, calls_day: '2026-09-18' });

    expect(calls[0]?.body).toEqual({
      last_success_at: NOW.toISOString(),
      daily_cap: 30,
      calls_today: 9,
      calls_day: '2026-09-18',
    });
  });

  it('rides the error write too, so a failed run still reports what it spent', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunError(env, NOW, 'gmail is down', {
      daily_cap: 30,
      calls_today: 4,
      calls_day: '2026-09-18',
    });

    expect(calls[0]?.body).toEqual({
      last_error: 'gmail is down',
      last_error_at: NOW.toISOString(),
      daily_cap: 30,
      calls_today: 4,
      calls_day: '2026-09-18',
    });
  });

  it('leaves the count out of the body when the caller has not read it yet', async () => {
    // A column absent from the PATCH keeps whatever the row holds; a null would wipe a true
    // count with a guess.
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunError(env, NOW, 'READER_MODEL is not set', { daily_cap: 30 });

    expect(Object.keys(calls[0]?.body ?? {})).toEqual(['last_error', 'last_error_at', 'daily_cap']);
  });
});

describe('the To Reader leg’s health', () => {
  const NOW_ISO = NOW.toISOString();

  it('rides the closing success write: a clean leg stamps its own success beside the tick’s', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunSuccess(env, NOW, { daily_cap: 30 }, { kind: 'success' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      last_success_at: NOW_ISO,
      daily_cap: 30,
      instapaper_last_success_at: NOW_ISO,
    });
  });

  it('rides the closing error write: an Instapaper failure never touches the summariser’s columns', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunSuccess(env, NOW, undefined, {
      kind: 'error',
      error: "Instapaper rejected alfred's credentials",
    });
    await recordRunError(env, NOW, 'gmail: 401', undefined, { kind: 'success' });

    expect(calls[0]?.body).toEqual({
      last_success_at: NOW_ISO,
      instapaper_last_error: "Instapaper rejected alfred's credentials",
      instapaper_last_error_at: NOW_ISO,
    });
    expect(calls[1]?.body).toEqual({
      last_error: 'gmail: 401',
      last_error_at: NOW_ISO,
      instapaper_last_success_at: NOW_ISO,
    });
  });

  it('writes nothing of its own when the leg had no outcome', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordRunSuccess(env, NOW);

    expect(Object.keys(calls[0]?.body ?? {})).toEqual(['last_success_at']);
  });

  it('stands alone on a path with no closing write, carrying only the leg’s columns', async () => {
    const calls = harness(() => Response.json([{ id: 1 }]));

    await recordInstapaperHealth(env, NOW, {
      kind: 'error',
      error: 'there is no “To Reader” folder in Instapaper',
    });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toContain('/reader_health?id=eq.1');
    expect(calls[0]?.body).toEqual({
      instapaper_last_error: 'there is no “To Reader” folder in Instapaper',
      instapaper_last_error_at: NOW_ISO,
    });
  });

  it('swallows a failed stand-alone write, like every health write', async () => {
    harness(() => new Response('nope', { status: 500 }));
    const logged = jest.spyOn(console, 'error').mockImplementation(NOTHING);

    await expect(recordInstapaperHealth(env, NOW, { kind: 'success' })).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });
});
