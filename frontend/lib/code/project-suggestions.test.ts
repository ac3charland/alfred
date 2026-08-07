import type { Project } from '@/lib/types';

import {
  applyProjectSuggestion,
  parseSuggestTrigger,
  projectSuggestionDomId,
  rankProjectSuggestions,
} from './project-suggestions';

function makeProject(id: string, name: string, key: string): Project {
  return {
    id,
    name,
    key,
    repo_owner: 'ac3charland',
    repo_name: name.toLowerCase(),
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  };
}

const ALFRED = makeProject('p-alf', 'Alfred', 'ALF');
const RELAY = makeProject('p-rlp', 'Relay', 'RLP');
const SANDBOX = makeProject('p-sbx', 'Sandbox', 'SBX');
const PROJECTS = [ALFRED, RELAY, SANDBOX];

describe('parseSuggestTrigger', () => {
  it('triggers on a bare colon with an empty query and remainder', () => {
    expect(parseSuggestTrigger(':')).toEqual({ query: '', remainder: '' });
  });

  it('takes the text after the colon as the query', () => {
    expect(parseSuggestTrigger(':al')).toEqual({ query: 'al', remainder: '' });
  });

  it('keeps the query as typed, case and all', () => {
    expect(parseSuggestTrigger(':ALF')).toEqual({ query: 'ALF', remainder: '' });
  });

  it('splits at the first whitespace: the first token is the query, the rest the remainder', () => {
    expect(parseSuggestTrigger(':alf add dark mode')).toEqual({
      query: 'alf',
      remainder: 'add dark mode',
    });
  });

  it('trims the remainder so extra spacing after the query is dropped', () => {
    expect(parseSuggestTrigger(':alf   add dark mode  ')).toEqual({
      query: 'alf',
      remainder: 'add dark mode',
    });
  });

  it('ignores leading whitespace before the colon', () => {
    expect(parseSuggestTrigger('  :alf')).toEqual({ query: 'alf', remainder: '' });
  });

  it('treats a newline as whitespace, so a second line is remainder', () => {
    expect(parseSuggestTrigger(':alf\nadd dark mode')).toEqual({
      query: 'alf',
      remainder: 'add dark mode',
    });
  });

  it('does not trigger when the colon is not leading', () => {
    expect(parseSuggestTrigger('ALF: add dark mode')).toBeNull();
    expect(parseSuggestTrigger('Note: buy milk')).toBeNull();
  });

  it('does not trigger when there is no colon at all', () => {
    expect(parseSuggestTrigger('buy milk')).toBeNull();
  });

  it('does not trigger on an empty value', () => {
    expect(parseSuggestTrigger('')).toBeNull();
    expect(parseSuggestTrigger(' '.repeat(3))).toBeNull();
  });
});

describe('rankProjectSuggestions', () => {
  it('returns every project in the given order for an empty query', () => {
    expect(rankProjectSuggestions('', PROJECTS)).toEqual(PROJECTS);
  });

  it('returns nothing when there are no projects', () => {
    expect(rankProjectSuggestions('alf', [])).toEqual([]);
    expect(rankProjectSuggestions('', [])).toEqual([]);
  });

  it('matches a project by a prefix of its key, case-insensitively', () => {
    expect(rankProjectSuggestions('al', PROJECTS)).toEqual([ALFRED]);
    expect(rankProjectSuggestions('ALF', PROJECTS)).toEqual([ALFRED]);
  });

  it('matches a project by a prefix of its name', () => {
    expect(rankProjectSuggestions('sandb', PROJECTS)).toEqual([SANDBOX]);
  });

  it('matches a substring of the key or the name', () => {
    expect(rankProjectSuggestions('fred', PROJECTS)).toEqual([ALFRED]);
    expect(rankProjectSuggestions('lp', PROJECTS)).toEqual([RELAY]);
  });

  it('drops projects that match neither key nor name', () => {
    expect(rankProjectSuggestions('zzz', PROJECTS)).toEqual([]);
  });

  it('ranks a prefix match ahead of a substring match, overriding the given order', () => {
    // `la` prefixes Board's key `LAB` (rank 0) but only sits inside Relay's name (rank 1), so
    // Board jumps the queue even though Relay comes first in the list.
    const board = makeProject('p-brd', 'Board', 'LAB');
    expect(rankProjectSuggestions('la', [RELAY, board])).toEqual([board, RELAY]);
  });

  it('takes the better of the key and name ranks', () => {
    // `sbx` is a prefix of Sandbox's key and absent from its name — the key rank must win.
    expect(rankProjectSuggestions('sbx', PROJECTS)).toEqual([SANDBOX]);
  });

  it('keeps the given order for ties, so the list reads in nav order', () => {
    const alpha = makeProject('p-a', 'Apples', 'APL');
    const beta = makeProject('p-b', 'Apricots', 'APR');
    expect(rankProjectSuggestions('ap', [alpha, beta])).toEqual([alpha, beta]);
    expect(rankProjectSuggestions('ap', [beta, alpha])).toEqual([beta, alpha]);
  });
});

describe('applyProjectSuggestion', () => {
  it('writes a bare prefix, trailing space and all, when there is no remainder', () => {
    expect(applyProjectSuggestion({ query: '', remainder: '' }, ALFRED)).toBe('ALF: ');
    expect(applyProjectSuggestion({ query: 'al', remainder: '' }, ALFRED)).toBe('ALF: ');
  });

  it('always writes the key, even when the user typed the name', () => {
    expect(applyProjectSuggestion({ query: 'alfred', remainder: '' }, ALFRED)).toBe('ALF: ');
  });

  it('preserves the remainder after the prefix', () => {
    expect(applyProjectSuggestion({ query: 'alf', remainder: 'add dark mode' }, ALFRED)).toBe(
      'ALF: add dark mode',
    );
  });
});

describe('projectSuggestionDomId', () => {
  it('is stable and unique per project', () => {
    expect(projectSuggestionDomId(ALFRED)).toBe('project-suggestion-p-alf');
    expect(projectSuggestionDomId(RELAY)).not.toBe(projectSuggestionDomId(ALFRED));
  });
});
