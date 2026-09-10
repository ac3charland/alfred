import { spyOnFetch } from '../fetch-stub';
import { GMAIL_API_BASE, MAX_MESSAGE_IDS, gmailClient } from './gmail-api';

interface Call {
  url: string;
  authorization: string | undefined;
}

/** Record every Gmail request and answer it with `respond`. */
function mockGmail(respond: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const sent = init?.headers as Record<string, string> | undefined;
    const call: Call = { url: input as string, authorization: sent?.['Authorization'] };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  return calls;
}

const query = (url: string): URLSearchParams => new URL(url).searchParams;

describe('gmailClient', () => {
  it('reads the profile with the bearer token', async () => {
    const calls = mockGmail(() =>
      Response.json({ emailAddress: 'Owner@Example.com', historyId: '9001' }),
    );

    await expect(gmailClient('access-token').getProfile()).resolves.toEqual({
      ok: true,
      value: { emailAddress: 'Owner@Example.com', historyId: '9001' },
    });
    expect(calls[0]?.url).toBe(`${GMAIL_API_BASE}/profile`);
    expect(calls[0]?.authorization).toBe('Bearer access-token');
  });

  it('pages messages.list until the token runs out', async () => {
    const pages = [
      { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'page-2' },
      { messages: [{ id: 'c' }] },
    ];
    const calls = mockGmail((call) =>
      Response.json(query(call.url).get('pageToken') === 'page-2' ? pages[1] : pages[0]),
    );

    await expect(gmailClient('t').listMessageIds({ q: 'newer_than:7d' })).resolves.toEqual({
      ok: true,
      value: { ids: ['a', 'b', 'c'], truncated: false },
    });
    expect(calls).toHaveLength(2);
    expect(query(calls[0]?.url ?? '').get('q')).toBe('newer_than:7d');
    expect(query(calls[1]?.url ?? '').get('pageToken')).toBe('page-2');
  });

  it('stops collecting ids at the per-poll cap and reports the listing as truncated', async () => {
    const ids = Array.from({ length: MAX_MESSAGE_IDS + 10 }, (_value, index) => ({
      id: `m${String(index)}`,
    }));
    mockGmail(() => Response.json({ messages: ids, nextPageToken: 'more' }));

    const listed = await gmailClient('t').listMessageIds({});
    expect(listed).toEqual({
      ok: true,
      value: {
        ids: ids.slice(0, MAX_MESSAGE_IDS).map((message) => message.id),
        truncated: true,
        // Gmail's own `nextPageToken` is forwarded whether or not our own cap was also the
        // reason for truncation — a caller resuming it does not need to know which applied.
        pageToken: 'more',
      },
    });
  });

  it('seeds a listing from a caller-supplied page token, picking up where a previous truncated call left off', async () => {
    const calls = mockGmail((call) =>
      query(call.url).get('pageToken') === 'resume-here'
        ? Response.json({ messages: [{ id: 'c' }] })
        : Response.json({ messages: [{ id: 'wrong-page' }] }),
    );

    const listed = await gmailClient('t').listMessageIds({
      q: 'after:100 before:200',
      pageToken: 'resume-here',
    });

    // The very first request already carries the caller's token — resuming a truncated listing
    // must not re-fetch its first page.
    expect(calls).toHaveLength(1);
    expect(query(calls[0]?.url ?? '').get('pageToken')).toBe('resume-here');
    expect(query(calls[0]?.url ?? '').get('q')).toBe('after:100 before:200');
    expect(listed).toEqual({
      ok: true,
      value: { ids: ['c'], truncated: false, pageToken: undefined },
    });
  });

  it('collects the ids a history walk added, deduped, and reports where it now stands', async () => {
    const calls = mockGmail(() =>
      Response.json({
        history: [
          { messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] },
          { messagesAdded: [{ message: { id: 'm1' } }] },
        ],
        historyId: '9100',
      }),
    );

    await expect(gmailClient('t').listHistory({ startHistoryId: '9000' })).resolves.toEqual({
      ok: true,
      value: { expired: false, messageIds: ['m1', 'm2'], historyId: '9100', truncated: false },
    });
    expect(query(calls[0]?.url ?? '').get('startHistoryId')).toBe('9000');
    expect(query(calls[0]?.url ?? '').get('historyTypes')).toBe('messageAdded');
  });

  it('stops a history walk at the id cap and resumes from the last record it fully consumed — never the mailbox head', async () => {
    const safe = Array.from({ length: MAX_MESSAGE_IDS - 5 }, (_value, index) => ({
      message: { id: `m${String(index)}` },
    }));
    const overflow = Array.from({ length: 10 }, (_value, index) => ({
      message: { id: `x${String(index)}` },
    }));
    mockGmail(() =>
      Response.json({
        history: [
          { id: 'rec-safe', messagesAdded: safe },
          { id: 'rec-overflow', messagesAdded: overflow },
        ],
        // The mailbox's CURRENT head at the moment of this walk — a truncated walk must never
        // advance to this, or everything `rec-overflow` (and anything after it) carries would be
        // skipped forever.
        historyId: 'mailbox-current-head',
      }),
    );

    await expect(gmailClient('t').listHistory({ startHistoryId: '9000' })).resolves.toEqual({
      ok: true,
      value: {
        expired: false,
        messageIds: safe.map((entry) => entry.message.id),
        historyId: 'rec-safe',
        truncated: true,
      },
    });
  });

  it('reports truncation when reaching the cap still leaves another history page unread', async () => {
    const page1 = Array.from({ length: MAX_MESSAGE_IDS }, (_value, index) => ({
      message: { id: `m${String(index)}` },
    }));
    const calls = mockGmail((call) =>
      query(call.url).get('pageToken') === 'page-2'
        ? Response.json({
            history: [{ id: 'rec-2', messagesAdded: [{ message: { id: 'later' } }] }],
          })
        : Response.json({
            history: [{ id: 'rec-1', messagesAdded: page1 }],
            nextPageToken: 'page-2',
          }),
    );

    await expect(gmailClient('t').listHistory({ startHistoryId: '9000' })).resolves.toEqual({
      ok: true,
      value: {
        expired: false,
        messageIds: page1.map((entry) => entry.message.id),
        historyId: 'rec-1',
        truncated: true,
      },
    });
    // The second page was never fetched — the cap was already reached after the first.
    expect(calls).toHaveLength(1);
  });

  it('reads a 404 from the history walk as an expired cursor, not a failure', async () => {
    mockGmail(() => new Response('gone', { status: 404 }));

    await expect(gmailClient('t').listHistory({ startHistoryId: '1' })).resolves.toEqual({
      ok: true,
      value: { expired: true },
    });
  });

  it('fetches one whole message', async () => {
    const calls = mockGmail(() => Response.json({ id: 'm1', threadId: 't1' }));

    await expect(gmailClient('t').getMessage('m1')).resolves.toEqual({
      ok: true,
      value: { id: 'm1', threadId: 't1' },
    });
    expect(calls[0]?.url).toContain(`${GMAIL_API_BASE}/messages/m1`);
    expect(query(calls[0]?.url ?? '').get('format')).toBe('full');
  });

  it.each([401, 403])('treats %i as rejected — a human has to re-authorize', async (status) => {
    mockGmail(() => new Response('nope', { status }));

    await expect(gmailClient('t').getProfile()).resolves.toEqual({
      ok: false,
      reason: 'rejected',
      detail: `${String(status)} nope`,
      status,
    });
  });

  it.each([429, 500, 503])('treats %i as transport — worth retrying next tick', async (status) => {
    mockGmail(() => new Response('slow down', { status }));

    const result = await gmailClient('t').getMessage('m1');
    expect(result).toEqual({
      ok: false,
      reason: 'transport',
      detail: `${String(status)} slow down`,
      status,
    });
  });

  it('treats a thrown fetch as transport', async () => {
    spyOnFetch().mockImplementation(() => Promise.reject(new Error('connection reset')));

    await expect(gmailClient('t').getProfile()).resolves.toEqual({
      ok: false,
      reason: 'transport',
      detail: 'connection reset',
    });
  });

  it('bounds every request with an abort signal, so a hung connection cannot run forever', async () => {
    let capturedSignal: AbortSignal | undefined | null;
    spyOnFetch().mockImplementation((_input, init) => {
      capturedSignal = init?.signal;
      return Promise.resolve(Response.json({ emailAddress: 'o@example.com', historyId: '1' }));
    });

    await gmailClient('t').getProfile();

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('treats a request that timed out as transport, not a content failure — worth retrying', async () => {
    spyOnFetch().mockImplementation(() =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );

    await expect(gmailClient('t').getMessage('m1')).resolves.toEqual({
      ok: false,
      reason: 'transport',
      // `DOMException` isn't a `describe()`-recognized `Error`, so it falls to `String(error)` —
      // which is exactly what a real timeout abort reason looks like.
      detail: 'TimeoutError: The operation timed out.',
    });
  });
});
