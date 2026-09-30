import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFixtureRepo } from './fixture-repo.ts';
import type { FixtureRepo } from './fixture-repo.ts';
import { GitHistory, gitIn } from './git.ts';
import type { PullRequest } from './prs.ts';
import { readSessionDir } from './records.ts';
import { BuilderLoader } from './replay.ts';
import { buildRows } from './row.ts';
import type { LedgerInputs, LedgerRow } from './types.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

let repo: FixtureRepo;
let tmp: string;
let rows: LedgerRow[];

function row(id: string): LedgerRow {
  const found = rows.find((candidate) => candidate.session_id === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

beforeAll(async () => {
  repo = buildFixtureRepo(mkdtempSync(path.join(os.tmpdir(), 'ledger-row-')));
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ledger-row-modules-'));
  const history = new GitHistory(gitIn(repo.dir));
  rows = await buildRows({
    repo: 'ac3charland/alfred',
    inputs: JSON.parse(readFileSync(path.join(FIXTURES, 'inputs.json'), 'utf8')) as LedgerInputs,
    pulls: JSON.parse(readFileSync(path.join(FIXTURES, 'pulls.json'), 'utf8')) as PullRequest[],
    sessions: readSessionDir(path.join(FIXTURES, 'sessions')),
    history,
    loader: new BuilderLoader(history, tmp),
  });
});

afterAll(() => {
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

describe('the session universe', () => {
  it('covers every alfred session and every PR-linked one, and nothing else', () => {
    expect(rows.map((r) => r.session_id)).not.toContain('session_15OtherRepo');
    expect(rows.map((r) => r.session_id)).toContain('session_16Unavailable');
  });
});

describe('an implementation session (the PR #415 shape)', () => {
  it('rebuilds its prompt at base, with its spec and both skills resolved there', () => {
    const r = row('session_01ImplSpec');
    expect(r).toMatchObject({
      ref: 'ALF-9',
      launch_lane: 'implementation',
      pr_number: 2,
      pr_state: 'merged',
      base_sha: repo.c5,
      builder_sha: repo.c4,
      prompt_source: 'reconstructed',
      spec_path: 'docs/specs/ALF-9.html',
      spec_blob_sha: '8e80d75df820d7c8134d0b295246ad8b6eee7c1e',
      human_commits_after_open: 0,
      warnings: [],
      cost_usd: 33.037491,
    });
    expect(r.prompt).toContain('Implement the spec at `docs/specs/ALF-9.html`');
    expect(r.skills.map((s) => s.path)).toEqual([
      '.claude/skills/implement-spec/SKILL.md',
      '.claude/skills/adversarial-review/SKILL.md',
    ]);
    expect(r.skills.every((s) => /^[0-9a-f]{40}$/.test(s.blob_sha ?? ''))).toBe(true);
  });

  it('gives a second session the same PR links its own row pointing at that PR', () => {
    expect(row('session_19Second')).toMatchObject({ pr_number: 2, ref: 'ALF-9' });
  });
});

describe('an older implementation session', () => {
  it('replays the builder of its day, counts human rework, and flags the extra PR', () => {
    const r = row('session_02ImplOld');
    expect(r).toMatchObject({
      base_sha: repo.c2,
      builder_sha: repo.c1,
      pr_number: 1,
      human_commits_after_open: 1,
      warnings: ['extra_prs'],
    });
    expect(r.skills.map((s) => s.path)).toEqual(['.claude/skills/implement-spec/SKILL.md']);
    expect(r.prompt).not.toContain('adversarial-review');
  });
});

describe('lanes and builders', () => {
  it('reads a Bug: story at a builder with buildBugUrl as the bug lane', () => {
    const r = row('session_04Bug');
    expect(r.launch_lane).toBe('bug');
    expect(r.skills.map((s) => s.path)).toContain('.claude/skills/bug/SKILL.md');
  });

  it('reads the same kind of story before buildBugUrl as bypass, whose builder did not exist yet', () => {
    expect(row('session_05BugOld')).toMatchObject({
      launch_lane: 'bypass',
      builder_sha: repo.c1,
      prompt: null,
      prompt_source: null,
      warnings: ['builder_missing'],
    });
  });

  it('warns builder_threw and leaves the prompt null when the builder throws', () => {
    expect(row('session_12Throws')).toMatchObject({ prompt: null, warnings: ['builder_threw'] });
  });

  it('warns when the builder changed on main within 30 minutes before the session', () => {
    expect(row('session_11NearStart').warnings).toEqual(['builder_changed_near_start']);
    expect(row('session_11NearStart').launch_lane).toBe('spike');
  });
});

describe('specs at base', () => {
  it('stores an epic implementation’s spec, and flags a recorded sha that no longer matches', () => {
    const r = row('session_07EpicImpl');
    expect(r).toMatchObject({
      launch_lane: 'epic-implementation',
      spec_path: 'docs/specs/epics/ALF-4.html',
      spec_blob_sha: '365d56009129210859b346fab0ee67b3eaceffce',
      warnings: ['spec_changed_since_refinement'],
    });
    expect(r.skills.map((s) => s.path)).toEqual(['.claude/skills/implement-epic/SKILL.md']);
  });

  it('shows a refinement its epic spec (present at base) but not its own (not yet written)', () => {
    const r = row('session_09Refine');
    expect(r.prompt).toContain('Epic spec: docs/specs/epics/ALF-4.html');
    expect(r.prompt).toContain('Existing spec: none yet');
    expect(r.spec_path).toBeNull();
  });

  it('marks a missing story and a spec absent at base', () => {
    expect(row('session_10Missing')).toMatchObject({
      prompt: null,
      spec_path: 'docs/specs/ALF-404.html',
      spec_blob_sha: null,
      pr_state: 'closed',
      warnings: ['spec_missing_at_base', 'story_missing'],
    });
  });
});

describe('skills at base', () => {
  it('records a skill the prompt names but that had not landed yet with a null blob', () => {
    const r = row('session_20SkillLater');
    expect(r).toMatchObject({ base_sha: repo.c4, launch_lane: 'bypass' });
    expect(r.skills).toEqual([
      { path: '.claude/skills/adversarial-review/SKILL.md', blob_sha: null },
    ]);
  });
});

describe('PR edge cases', () => {
  it('flags a head that did not grow from main-at-start, leaving rework uncounted', () => {
    expect(row('session_03Stale')).toMatchObject({
      pr_state: 'open',
      human_commits_after_open: null,
      warnings: ['not_from_main'],
    });
  });

  it('keeps session and PR fields for a PR without a block', () => {
    expect(row('session_06NoBlock')).toMatchObject({
      ref: null,
      launch_lane: null,
      pr_number: 7,
      prompt: null,
      warnings: ['no_alfred_block'],
    });
  });

  it('builds a row from its PR alone when the record never arrived', () => {
    expect(row('session_16Unavailable')).toMatchObject({
      pr_number: 14,
      ref: 'ALF-10',
      cost_usd: null,
      base_sha: null,
      session_record: null,
      warnings: ['session_record_unavailable'],
    });
  });
});

describe('sessions with no PR', () => {
  it('keeps a title ref only when it names a known story or epic', () => {
    expect(row('session_13NoPrRef')).toMatchObject({
      ref: 'ALF-9',
      launch_lane: null,
      pr_number: null,
      prompt: null,
      builder_sha: null,
      base_sha: repo.m2,
      skills: [],
      cost_usd: 6.412208,
      status: 'SESSION_STATUS_BUCKET_FAILED',
      warnings: ['no_pr', 'ref_from_title'],
    });
    expect(row('session_14NoPrUnknown')).toMatchObject({ ref: null, warnings: ['no_pr'] });
  });

  it('gives an invalid or unavailable record its warning and a row anyway', () => {
    expect(row('session_17Invalid').warnings).toEqual(['no_pr', 'session_record_invalid']);
    expect(row('session_18Gone').warnings).toEqual(['no_pr', 'session_record_unavailable']);
  });
});
