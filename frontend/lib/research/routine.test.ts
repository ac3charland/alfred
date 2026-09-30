/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { ResearchConfig } from './config';
import {
  BRIEF_MAX_CHARS,
  BRIEF_TRUNCATION_NOTE,
  FIRE_TIMEOUT_MS,
  ROUTINE_ANTHROPIC_VERSION,
  ROUTINE_BETA_HEADER,
  fireResearchRoutine,
} from './routine';

jest.mock('server-only', () => ({}));

const FIRE_TOKEN = 'fire-token-secret';

const CONFIG: ResearchConfig = {
  fireUrl: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  fireToken: FIRE_TOKEN,
  deliveryKey: 'delivery-key-secret',
};

const POST = {
  id: '6f1c2b3a-0000-4000-8000-00000000000a',
  research_brief: 'Is a cold-climate heat pump worth it?\n\nCompare against the gas furnace.',
};

const SESSION_URL = 'https://claude.ai/code/session_01Abc';

/** The Routine's 2xx answer, in the shape the research preview documents. */
function fireAnswer(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    type: 'routine_fire',
    claude_code_session_id: 'session_01Abc',
    claude_code_session_url: SESSION_URL,
    ...overrides,
  });
}

function fetchAnswers(response: Response | (() => Response)): jest.SpiedFunction<typeof fetch> {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(typeof response === 'function' ? response() : response),
    );
}

/** What the one recorded fetch was asked to do. */
function recordedRequest(spy: jest.SpiedFunction<typeof fetch>): {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: { text: string };
} {
  const [url, init] = spy.mock.calls[0] ?? [];
  if (typeof url !== 'string' || init === undefined) throw new Error('fetch was not called');
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(typeof init.body === 'string' ? init.body : '') as { text: string },
  };
}

describe('the fire request', () => {
  it('POSTs the brief, prefixed with the post id, to the Routine’s fire URL', async () => {
    const spy = fetchAnswers(() => fireAnswer());

    await fireResearchRoutine(CONFIG, POST);

    expect(spy).toHaveBeenCalledTimes(1);
    const { url, init, body } = recordedRequest(spy);
    expect(url).toBe(CONFIG.fireUrl);
    expect(init.method).toBe('POST');
    expect(body).toEqual({ text: `post_id=${POST.id}\n---\n${POST.research_brief}` });
  });

  it('carries the bearer token, the beta header, the API version and a JSON content type', async () => {
    const spy = fetchAnswers(() => fireAnswer());

    await fireResearchRoutine(CONFIG, POST);

    expect(recordedRequest(spy).headers).toEqual({
      Authorization: `Bearer ${FIRE_TOKEN}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    });
  });

  it('exports the beta header and API version as constants, so the preview’s header lives in one place', () => {
    expect(ROUTINE_BETA_HEADER).toBe('experimental-cc-routine-2026-04-01');
    expect(ROUTINE_ANTHROPIC_VERSION).toBe('2023-06-01');
  });

  it('gives the request a ten-second timeout', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const spy = fetchAnswers(() => fireAnswer());

    await fireResearchRoutine(CONFIG, POST);

    expect(FIRE_TIMEOUT_MS).toBe(10_000);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(recordedRequest(spy).init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('the brief', () => {
  it('sends a brief at exactly the limit whole', async () => {
    const brief = 'a'.repeat(BRIEF_MAX_CHARS);
    const spy = fetchAnswers(() => fireAnswer());

    await fireResearchRoutine(CONFIG, { ...POST, research_brief: brief });

    expect(recordedRequest(spy).body.text).toBe(`post_id=${POST.id}\n---\n${brief}`);
  });

  it('cuts a brief over the limit to 16 000 characters and says so', async () => {
    const spy = fetchAnswers(() => fireAnswer());

    await fireResearchRoutine(CONFIG, { ...POST, research_brief: 'b'.repeat(BRIEF_MAX_CHARS + 1) });

    const { text } = recordedRequest(spy).body;
    expect(BRIEF_MAX_CHARS).toBe(16_000);
    expect(BRIEF_TRUNCATION_NOTE).toBe('\n[brief truncated]');
    expect(text).toBe(`post_id=${POST.id}\n---\n${'b'.repeat(16_000)}\n[brief truncated]`);
  });

  it('never cuts a character in half — an emoji straddling the limit is left out whole', async () => {
    const spy = fetchAnswers(() => fireAnswer());
    // 15 999 characters, then a two-unit emoji whose second half would be unit 16 001.
    const brief = `${'b'.repeat(BRIEF_MAX_CHARS - 1)}🔬 and more`;

    await fireResearchRoutine(CONFIG, { ...POST, research_brief: brief });

    const { text } = recordedRequest(spy).body;
    expect(text).toBe(`post_id=${POST.id}\n---\n${'b'.repeat(15_999)}\n[brief truncated]`);
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('a 2xx answer', () => {
  it('reads the session URL from the body', async () => {
    fetchAnswers(() => fireAnswer());

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: true,
      sessionUrl: SESSION_URL,
    });
  });

  it.each([
    ['absent', {}],
    ['not a string', { claude_code_session_url: 42 }],
    // A host with no public TLD: unicorn/prefer-https rewrites any other http:// literal.
    ['not https', { claude_code_session_url: 'http://localhost/code/session_01Abc' }],
    ['a javascript: URL', { claude_code_session_url: 'javascript:alert(1)' }],
    ['not a URL at all', { claude_code_session_url: 'session_01Abc' }],
  ])('still succeeds, with no session URL, when it is %s', async (_label, fields) => {
    fetchAnswers(() => Response.json({ type: 'routine_fire', ...fields }, { status: 200 }));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: true,
      sessionUrl: null,
    });
  });

  it('still succeeds, with no session URL, when the body is not JSON', async () => {
    fetchAnswers(() => new Response('started', { status: 200 }));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: true,
      sessionUrl: null,
    });
  });

  it('still succeeds when the body is JSON but not an object', async () => {
    fetchAnswers(() => Response.json(null, { status: 200 }));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: true,
      sessionUrl: null,
    });
  });

  it('treats any 2xx as accepted', async () => {
    fetchAnswers(() => Response.json({ claude_code_session_url: SESSION_URL }, { status: 202 }));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: true,
      sessionUrl: SESSION_URL,
    });
  });
});

describe('a failed fire', () => {
  it.each([
    [401, 'the research Routine refused alfred’s token'],
    [403, 'the research Routine refused alfred’s token'],
    [429, 'the Routine’s daily run cap or usage limit was reached'],
    [400, 'the research Routine answered HTTP 400'],
    [404, 'the research Routine answered HTTP 404'],
    [500, 'the research Routine answered HTTP 500'],
    [503, 'the research Routine answered HTTP 503'],
    [301, 'the research Routine answered HTTP 301'],
  ])('maps an HTTP %i to its sentence', async (status, error) => {
    fetchAnswers(() => Response.json({ error: 'nope' }, { status }));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({ ok: false, error });
  });

  it('says the Routine could not be reached on a network error', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: false,
      error: 'the research Routine couldn’t be reached',
    });
  });

  it('says the Routine could not be reached when the ten-second timeout fires', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(fireResearchRoutine(CONFIG, POST)).resolves.toEqual({
      ok: false,
      error: 'the research Routine couldn’t be reached',
    });
  });
});

describe('logging', () => {
  it('never logs the token or the brief, on success or failure', async () => {
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'info').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
    ];

    fetchAnswers(() => fireAnswer());
    await fireResearchRoutine(CONFIG, POST);
    fetchAnswers(() => Response.json({ error: FIRE_TOKEN }, { status: 401 }));
    await fireResearchRoutine(CONFIG, POST);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError(`bad ${FIRE_TOKEN}`));
    const outcome = await fireResearchRoutine(CONFIG, POST);

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(FIRE_TOKEN);
    expect(logged).not.toContain('cold-climate');
    // Nor does the outcome handed back carry them: it is stored on the row and shown to the owner.
    expect(JSON.stringify(outcome)).not.toContain(FIRE_TOKEN);
  });
});
