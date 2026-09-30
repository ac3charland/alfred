import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildFixtureRepo } from './fixture-repo.ts';
import type { FixtureRepo } from './fixture-repo.ts';
import { BUILDER_PATH, GitHistory, gitIn } from './git.ts';

let repo: FixtureRepo;
let history: GitHistory;

beforeAll(() => {
  repo = buildFixtureRepo(mkdtempSync(path.join(os.tmpdir(), 'ledger-git-')));
  history = new GitHistory(gitIn(repo.dir));
});

afterAll(() => {
  rmSync(repo.dir, { recursive: true, force: true });
});

describe('baseShaAt', () => {
  it('is the last first-parent main commit at or before the session started', () => {
    expect(history.baseShaAt(new Date('2026-07-03T09:00:00Z'))).toBe(repo.c2);
    expect(history.baseShaAt(new Date('2026-07-02T00:00:00Z'))).toBe(repo.c2);
    expect(history.baseShaAt(new Date('2026-07-03T12:30:00Z'))).toBe(repo.c3);
    expect(history.baseShaAt(new Date('2026-07-10T01:00:00Z'))).toBe(repo.c5);
    expect(history.baseShaAt(new Date('2026-07-20T00:00:00Z'))).toBe(repo.m2);
  });

  it('never lands on a branch commit, only main’s own line', () => {
    // a2 (12:00) was on the PR branch; main at 12:30 is still c3.
    expect(history.baseShaAt(new Date('2026-07-03T12:30:00Z'))).not.toBe(repo.a2);
  });

  it('is null before main had any commit', () => {
    expect(history.baseShaAt(new Date('2026-06-01T00:00:00Z'))).toBeNull();
  });
});

describe('builderSha / builderLandedAt', () => {
  it('is the last change to the builder file as of base', () => {
    expect(history.builderSha(repo.m1)).toBe(repo.c1);
    expect(history.builderSha(repo.c5)).toBe(repo.c4);
    expect(history.builderLandedAt(repo.c5)).toBe(Date.parse('2026-07-10T00:00:00Z') / 1000);
  });
});

describe('blobAt / showFile', () => {
  it('resolves a file present at a commit and nulls one that is not yet there', () => {
    const review = '.claude/skills/adversarial-review/SKILL.md';
    expect(history.blobAt(repo.c4, review)).toBeNull();
    expect(history.blobAt(repo.c5, review)).toMatch(/^[0-9a-f]{40}$/);
    expect(history.showFile(repo.c1, BUILDER_PATH)).toContain('prompt=');
    expect(history.showFile(repo.c1, 'missing.ts')).toBeNull();
  });
});

describe('isAncestor', () => {
  it('holds for a branch grown from base, and not for one forked from an older commit', () => {
    expect(history.isAncestor(repo.c2, repo.a2)).toBe(true);
    expect(history.isAncestor(repo.c5, repo.b1)).toBe(false);
  });
});

describe('humanCommitsAfter', () => {
  it('counts only non-merge, non-Claude commits after open on the branch’s own line', () => {
    // a2 counts. a1 is Claude's; the merge of main is a merge; c3 — a human commit after open —
    // arrived through that merge, so first-parent keeps it out.
    expect(history.humanCommitsAfter(repo.c2, repo.a2, new Date('2026-07-03T11:00:00Z'))).toBe(1);
  });

  it('ignores human commits made before the PR opened', () => {
    expect(history.humanCommitsAfter(repo.c2, repo.a2, new Date('2026-07-03T12:30:00Z'))).toBe(0);
  });
});

describe('ensureHead / isShallow', () => {
  it('finds a head already present, and reports one it cannot fetch', () => {
    expect(history.ensureHead(1, repo.a2)).toBe(true);
    expect(history.ensureHead(99, 'e'.repeat(40))).toBe(false);
    expect(history.isShallow()).toBe(false);
  });
});

describe('the fixture repo', () => {
  it('is byte-for-byte reproducible — the golden file pins its shas', () => {
    const again = buildFixtureRepo(mkdtempSync(path.join(os.tmpdir(), 'ledger-git-again-')));
    try {
      expect({ ...again, dir: '' }).toEqual({ ...repo, dir: '' });
    } finally {
      rmSync(again.dir, { recursive: true, force: true });
    }
  });
});
