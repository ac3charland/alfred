import { dropSession, landSessionChange, sessionsForStory } from '@/lib/code/session-links';
import type { CodeSessionLink } from '@/lib/types';

const STORY = { ref: 'ALF-359', repo_owner: 'ac3charland', repo_name: 'alfred' };

function link(overrides: Partial<CodeSessionLink> = {}): CodeSessionLink {
  return {
    session_id: 'session_a',
    ref: 'ALF-359',
    repo: 'ac3charland/alfred',
    launch_lane: 'implementation',
    session_created_at: '2026-11-21T15:14:00Z',
    ...overrides,
  };
}

describe('sessionsForStory', () => {
  it('lists the story’s sessions newest first, with no start time last and ids breaking ties', () => {
    const sessions = [
      link({ session_id: 'session_old', session_created_at: '2026-11-19T17:47:00Z' }),
      link({ session_id: 'session_none_b', session_created_at: null }),
      link({ session_id: 'session_new', session_created_at: '2026-11-21T15:14:00.000+00:00' }),
      link({ session_id: 'session_none_a', session_created_at: null }),
      link({ session_id: 'session_tie_b', session_created_at: '2026-11-20T21:02:00Z' }),
      link({ session_id: 'session_tie_a', session_created_at: '2026-11-20T21:02:00Z' }),
    ];
    expect(sessionsForStory(sessions, STORY).map((s) => s.session_id)).toEqual([
      'session_new',
      'session_tie_a',
      'session_tie_b',
      'session_old',
      'session_none_a',
      'session_none_b',
    ]);
  });

  it('leaves out another ref, and the same ref recorded from another repo', () => {
    const sessions = [
      link({ session_id: 'session_mine' }),
      link({ session_id: 'session_other_ref', ref: 'ALF-35' }),
      link({ session_id: 'session_other_repo', repo: 'ac3charland/realplay' }),
    ];
    expect(sessionsForStory(sessions, STORY).map((s) => s.session_id)).toEqual(['session_mine']);
  });

  it('is empty for a story with no ref or repo', () => {
    expect(sessionsForStory([link()], { ...STORY, ref: null })).toEqual([]);
    expect(sessionsForStory([link()], { ...STORY, repo_owner: null })).toEqual([]);
  });
});

describe('landSessionChange', () => {
  it('adds a new session, with nulls for the columns its payload left out', () => {
    expect(
      landSessionChange([], {
        session_id: 'session_a',
        ref: 'ALF-359',
        repo: 'ac3charland/alfred',
      }),
    ).toEqual([link({ launch_lane: null, session_created_at: null })]);
  });

  it('keeps the held lane and time when an UPDATE omits them, and takes what it carried', () => {
    const held = [link(), link({ session_id: 'session_b' })];
    const next = landSessionChange(held, {
      session_id: 'session_a',
      ref: 'ALF-359',
      repo: 'ac3charland/alfred',
    });
    expect(next).toContainEqual(link());
    expect(next).toHaveLength(2);

    const relabelled = landSessionChange(held, { session_id: 'session_a', launch_lane: 'bug' });
    expect(relabelled).toContainEqual(link({ launch_lane: 'bug' }));
  });

  it('reads an unknown stored lane as no lane', () => {
    expect(landSessionChange([link()], { session_id: 'session_a', launch_lane: 'human' })).toEqual([
      link({ launch_lane: null }),
    ]);
  });

  it('ignores a session with no ref, and one it cannot key or place in a repo', () => {
    expect(
      landSessionChange([], { session_id: 'session_a', ref: null, repo: 'ac3charland/alfred' }),
    ).toEqual([]);
    expect(landSessionChange([], { ref: 'ALF-359', repo: 'ac3charland/alfred' })).toEqual([]);
    expect(landSessionChange([], { session_id: 'session_a', ref: 'ALF-359' })).toEqual([]);
  });
});

describe('dropSession', () => {
  it('removes the deleted session only', () => {
    const sessions = [link(), link({ session_id: 'session_b' })];
    expect(dropSession(sessions, 'session_a')).toEqual([link({ session_id: 'session_b' })]);
    expect(dropSession(sessions, undefined)).toEqual(sessions);
  });
});
