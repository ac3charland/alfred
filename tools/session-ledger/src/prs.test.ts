import { fetchPulls, linkSessions, prState, sessionIdsIn } from './prs.ts';
import type { PullRequest } from './prs.ts';

function pull(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'feat(x): a change',
    state: 'closed',
    created_at: '2026-09-01T00:00:00Z',
    merged_at: '2026-09-02T00:00:00Z',
    closed_at: '2026-09-02T00:00:00Z',
    body: null,
    head: { sha: 'f'.repeat(40) },
    ...overrides,
  };
}

const BLOCK = (ref: string, phase = 'implementation') =>
  ['```alfred', `alfred-ticket: ${ref}`, `phase: ${phase}`, '```'].join('\n');

describe('sessionIdsIn', () => {
  it('finds every session link, once each, in order', () => {
    const body = [
      'https://claude.ai/code/session_01Alpha',
      'see also claude.ai/code/session_02Beta and https://claude.ai/code/session_01Alpha again',
    ].join('\n');
    expect(sessionIdsIn(body)).toEqual(['session_01Alpha', 'session_02Beta']);
  });

  it('answers nothing for an empty body', () => {
    expect(sessionIdsIn(null)).toEqual([]);
  });
});

describe('prState', () => {
  it('distinguishes merged, closed unmerged, and open', () => {
    expect(prState(pull())).toBe('merged');
    expect(prState(pull({ merged_at: null }))).toBe('closed');
    expect(prState(pull({ state: 'open', merged_at: null, closed_at: null }))).toBe('open');
  });
});

describe('linkSessions', () => {
  it('gives each session linked by one PR that PR and its parsed block', () => {
    const links = linkSessions([
      pull({ number: 7, body: `${BLOCK('ALF-9')}\nhttps://claude.ai/code/session_01Alpha` }),
    ]);
    const link = links.get('session_01Alpha');
    expect(link?.pr.number).toBe(7);
    expect(link?.block?.tickets).toEqual(['ALF-9']);
    expect(link?.extraPrs).toEqual([]);
  });

  it('points every session of a multi-session PR at that PR', () => {
    const links = linkSessions([
      pull({
        number: 7,
        body: 'claude.ai/code/session_01Alpha claude.ai/code/session_02Beta',
      }),
    ]);
    expect(links.get('session_01Alpha')?.pr.number).toBe(7);
    expect(links.get('session_02Beta')?.pr.number).toBe(7);
  });

  it('parses a PR with no block as linked but blockless', () => {
    const links = linkSessions([pull({ number: 3, body: 'claude.ai/code/session_01Alpha' })]);
    expect(links.get('session_01Alpha')?.block).toBeUndefined();
  });

  it('gives a session two PRs link to the earliest PR with a block, the other as extra', () => {
    const links = linkSessions([
      pull({
        number: 12,
        created_at: '2026-09-03T00:00:00Z',
        body: `${BLOCK('ALF-9')}\nclaude.ai/code/session_01Alpha`,
      }),
      pull({
        number: 10,
        created_at: '2026-09-01T00:00:00Z',
        body: 'claude.ai/code/session_01Alpha',
      }),
      pull({
        number: 11,
        created_at: '2026-09-02T00:00:00Z',
        body: `${BLOCK('ALF-9')}\nclaude.ai/code/session_01Alpha`,
      }),
    ]);
    const link = links.get('session_01Alpha');
    expect(link?.pr.number).toBe(11);
    expect(link?.extraPrs).toEqual([10, 12]);
  });

  it('falls back to the earliest PR when none has a block', () => {
    const links = linkSessions([
      pull({ number: 5, created_at: '2026-09-05T00:00:00Z', body: 'claude.ai/code/session_01A' }),
      pull({ number: 4, created_at: '2026-09-04T00:00:00Z', body: 'claude.ai/code/session_01A' }),
    ]);
    expect(links.get('session_01A')?.pr.number).toBe(4);
    expect(links.get('session_01A')?.extraPrs).toEqual([5]);
  });
});

/** GitHub refusing every page — an exhausted unauthenticated rate limit answers exactly this. */
function forbidden() {
  return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
}

describe('fetchPulls', () => {
  it('pages the REST list until a short page, sending the token only when set', async () => {
    const requested: { url: string; headers: Record<string, string> }[] = [];
    const pages = [
      Array.from({ length: 100 }, (_, i) => pull({ number: i + 1 })),
      [pull({ number: 101 })],
    ];
    const fetchFn = (url: string, init: { headers: Record<string, string> }) => {
      requested.push({ url, headers: init.headers });
      const page = pages[requested.length - 1] ?? [];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(page) });
    };

    const pulls = await fetchPulls('ac3charland/alfred', { fetchFn, token: 'ghp_x' });

    expect(pulls).toHaveLength(101);
    expect(requested.map((r) => new URL(r.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(requested[0]?.url).toContain('/repos/ac3charland/alfred/pulls?state=all&per_page=100');
    expect(requested[0]?.headers['authorization']).toBe('Bearer ghp_x');

    requested.length = 0;
    pages.splice(0, 2, [pull()]);
    await fetchPulls('ac3charland/alfred', { fetchFn });
    expect(requested[0]?.headers['authorization']).toBeUndefined();
  });

  it('throws on a failed page, naming the status — a partial PR list would mislabel sessions', async () => {
    await expect(fetchPulls('ac3charland/alfred', { fetchFn: forbidden })).rejects.toThrow(/403/);
  });
});
