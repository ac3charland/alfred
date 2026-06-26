#!/usr/bin/env node
// batch-commit.mjs — create several commits in one pass while running the
// check:fast gate only ONCE.
//
// Why this exists: the pre-commit hook runs `npm run check:fast` on every
// commit. When a finished, green diff is split into N logical commits, those N
// runs all validate the SAME final working tree — so N-1 of them are redundant
// repeats of an identical green check. This tool:
//   1. validates every commit message with commitlint up front;
//   2. runs check:fast ONCE (it applies eslint --fix / prettier --write so the
//      tree is final, and runs typecheck + tests — if it fails, nothing is
//      committed);
//   3. creates all the commits with --no-verify (the gate already ran; messages
//      already validated).
// pre-push / check:slow is untouched, so the push gate still fires.
//
// This is the SOLE sanctioned use of --no-verify in alfred (see CLAUDE.md and
// the commitlint skill).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBatchInput, resolveSignFlag, validateCommits } from './parse.mjs';

const USAGE = [
  'Usage: node .claude/skills/batch-commits/scripts/batch-commit.mjs <input-file> [--gpg-sign | --no-gpg-sign]',
  '',
  'Create several commits in one pass, running check:fast only once.',
  '',
  'Input format (block text):',
  '',
  '  message: feat(scope): subject line',
  '    path/to/file-a',
  '    path/to/file-b',
  '',
  '  message: test(scope): another subject',
  '    path/to/file-c',
  '',
  'Rules: a "message:" line starts a commit; following non-blank lines are its',
  'file paths; blank lines separate commits; "#" lines are comments.',
  '',
  'Signing: by default each commit honors the repo\'s commit.gpgsign setting',
  '(--no-verify skips hooks, not signing). Pass --gpg-sign or --no-gpg-sign to force it.',
].join('\n');

function fail(message) {
  console.error(`batch-commit: ${message}`);
  process.exitCode = 1;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function partialSummary(created) {
  if (created.length === 0) return 'No commits were created.';
  return [
    `Committed ${created.length} of the batch before stopping:`,
    ...created.map((m) => `  ✓ ${m}`),
    'The working tree still holds the remaining changes; inspect with `git status`.',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  // The input path is the first positional arg; flags (--gpg-sign, …) may sit on either side.
  const inputPath = args.find((a) => !a.startsWith('-'));
  if (!inputPath || args.includes('--help') || args.includes('-h')) {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(USAGE);
    } else {
      console.error(USAGE);
      process.exitCode = 1;
    }
    return;
  }

  // 1. Resolve repo root; run everything relative to it.
  const toplevel = run('git', ['rev-parse', '--show-toplevel']);
  if (toplevel.status !== 0) {
    fail('not inside a git repository');
    return;
  }
  const repoRoot = toplevel.stdout.trim();
  const git = (gitArgs, opts = {}) => run('git', gitArgs, { cwd: repoRoot, ...opts });

  // Decide signing once: honor commit.gpgsign unless a CLI flag overrides it. --no-verify
  // (used on each commit below) skips hooks but NOT signing, so without this an unsigned
  // commit only happens when the repo isn't configured to sign in the first place.
  const gpgsignConfigured =
    git(['config', '--bool', '--get', 'commit.gpgsign']).stdout.trim() === 'true';
  const signFlag = resolveSignFlag({ argv: args, gpgsignConfigured });

  // 2. Parse input.
  let commits;
  try {
    commits = parseBatchInput(readFileSync(inputPath, 'utf8')).commits;
  } catch (error) {
    fail(`could not read/parse "${inputPath}": ${error.message}`);
    return;
  }

  // 3. Structural validation.
  const structuralErrors = validateCommits(commits);
  if (structuralErrors.length > 0) {
    fail('invalid batch input:');
    structuralErrors.forEach((e) => console.error(`  - ${e}`));
    return;
  }

  // 4. Validate EVERY commit message with commitlint up front. --no-verify
  //    (used below) skips the commit-msg hook, so this is the only message
  //    check the batch gets. Mirror the hook: `npx --no -- commitlint --edit`.
  const tmp = mkdtempSync(join(tmpdir(), 'batch-commit-'));
  try {
    const messageErrors = [];
    commits.forEach((commit, i) => {
      const msgFile = join(tmp, `msg-${i}`);
      writeFileSync(msgFile, `${commit.message}\n`);
      const res = run('npx', ['--no', '--', 'commitlint', '--edit', msgFile], {
        cwd: repoRoot,
      });
      if (res.status !== 0) {
        messageErrors.push(
          `commit ${i + 1} ("${commit.message}"):\n${`${res.stdout}${res.stderr}`.trim()}`,
        );
      }
    });
    if (messageErrors.length > 0) {
      fail('commit message(s) rejected by commitlint:');
      messageErrors.forEach((e) => console.error(`  - ${e}`));
      return;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 5. Pre-flight gate: run check:fast ONCE. If it fails, NOTHING is committed.
  console.error('batch-commit: running check:fast once (pre-flight gate)…');
  const check = run('npm', ['run', 'check:fast'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (check.status !== 0) {
    fail('check:fast failed — no commits made. Fix the code and re-run.');
    return;
  }

  // 6. Deterministic staging baseline: unstage anything already staged so only
  //    each group's own paths get committed.
  if (git(['rev-parse', '--verify', '-q', 'HEAD']).status === 0) {
    git(['reset', '-q']);
  }

  // 7. Emptiness / pathspec pre-check (uses --dry-run, stages nothing) so the
  //    whole batch aborts BEFORE the first commit if a group is empty or a path
  //    is wrong.
  const preErrors = [];
  const warnings = [];
  commits.forEach((commit, i) => {
    const n = i + 1;
    let groupStages = false;
    let groupHadError = false;
    for (const file of commit.files) {
      const res = git(['add', '--dry-run', '--', file]);
      if (res.status !== 0) {
        groupHadError = true;
        preErrors.push(`commit ${n}: cannot stage "${file}": ${res.stderr.trim()}`);
      } else if (res.stdout.trim() === '') {
        warnings.push(`commit ${n}: "${file}" has no pending changes (skipped)`);
      } else {
        groupStages = true;
      }
    }
    if (!groupHadError && !groupStages) {
      preErrors.push(
        `commit ${n}: none of its files have pending changes (would be an empty commit)`,
      );
    }
  });
  if (preErrors.length > 0) {
    fail('cannot create the batch:');
    preErrors.forEach((e) => console.error(`  - ${e}`));
    return;
  }
  warnings.forEach((w) => console.error(`batch-commit: warning: ${w}`));

  // 8. Commit loop. Groups are disjoint, so staging only each group's paths
  //    keeps them separate; commit with --no-verify.
  const created = [];
  for (let i = 0; i < commits.length; i += 1) {
    const commit = commits[i];
    const n = i + 1;

    const add = git(['add', '--', ...commit.files]);
    if (add.status !== 0) {
      fail(`staging commit ${n} failed: ${add.stderr.trim()}\n${partialSummary(created)}`);
      return;
    }
    if (git(['diff', '--cached', '--quiet']).status === 0) {
      fail(`commit ${n} would be empty after staging\n${partialSummary(created)}`);
      return;
    }
    const res = git([
      'commit',
      '-m',
      commit.message,
      '--no-verify',
      ...(signFlag ? [signFlag] : []),
    ]);
    if (res.status !== 0) {
      fail(`commit ${n} failed: ${res.stderr.trim()}\n${partialSummary(created)}`);
      return;
    }
    created.push(commit.message);
  }

  // 9. Report.
  console.log(`Created ${created.length} commit(s):`);
  created.forEach((m) => console.log(`  ✓ ${m}`));
  const leftover = git(['status', '--porcelain']).stdout.trim();
  if (leftover) {
    console.log('\nRemaining uncommitted changes (not assigned to any commit):');
    console.log(
      leftover
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
  }
}

main();
