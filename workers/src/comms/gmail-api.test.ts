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
      value: ['a', 'b', 'c'],
    });
    expect(calls).toHaveLength(2);
    expect(query(calls[0]?.url ?? '').get('q')).toBe('newer_than:7d');
    expect(query(calls[1]?.url ?? '').get('pageToken')).toBe('page-2');
  });

  it('stops collecting ids at the per-poll cap', async () => {
    const ids = Array.from({ length: MAX_MESSAGE_IDS + 10 }, (_value, index) => ({
      id: `m${String(index)}`,
    }));
    mockGmail(() => Response.json({ messages: ids, nextPageToken: 'more' }));

    const listed = await gmailClient('t').listMessageIds({});
    expect(listed.ok && listed.value).toHaveLength(MAX_MESSAGE_IDS);
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
      value: { expired: false, messageIds: ['m1', 'm2'], historyId: '9100' },
    });
    expect(query(calls[0]?.url ?? '').get('startHistoryId')).toBe('9000');
    expect(query(calls[0]?.url ?? '').get('historyTypes')).toBe('messageAdded');
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
});
