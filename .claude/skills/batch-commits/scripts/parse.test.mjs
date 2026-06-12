import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBatchInput, validateCommits } from './parse.mjs';

test('parses commits with their files in order', () => {
  const { commits } = parseBatchInput(
    [
      'message: feat(tasks): add inline subtask rows',
      '  frontend/components/TaskRow.tsx',
      '  frontend/components/SubtaskList.tsx',
      '',
      'message: test(tasks): cover subtask expansion',
      '  frontend/components/TaskRow.test.tsx',
    ].join('\n'),
  );

  assert.deepEqual(commits, [
    {
      message: 'feat(tasks): add inline subtask rows',
      files: [
        'frontend/components/TaskRow.tsx',
        'frontend/components/SubtaskList.tsx',
      ],
    },
    {
      message: 'test(tasks): cover subtask expansion',
      files: ['frontend/components/TaskRow.test.tsx'],
    },
  ]);
});

test('ignores blank lines and # comments', () => {
  const { commits } = parseBatchInput(
    [
      '# this is a comment',
      'message: docs(readme): tidy intro',
      '',
      '  # not a path either',
      '  README.md',
      '',
      '',
    ].join('\n'),
  );

  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].files, ['README.md']);
});

test('preserves spaces inside a file path', () => {
  const { commits } = parseBatchInput(
    ['message: chore(assets): rename art', '  frontend/public/my art.png'].join('\n'),
  );

  assert.deepEqual(commits[0].files, ['frontend/public/my art.png']);
});

test('throws when a file path precedes any message', () => {
  assert.throws(
    () => parseBatchInput('frontend/orphan.ts\nmessage: feat(x): y'),
    /appears before any "message:" line/,
  );
});

test('validateCommits flags empty input', () => {
  assert.deepEqual(validateCommits([]), [
    'no commits found (expected at least one "message:" block)',
  ]);
});

test('validateCommits flags an empty message and a fileless commit', () => {
  const errors = validateCommits([
    { message: '', files: ['a.ts'] },
    { message: 'feat(x): y', files: [] },
  ]);

  assert.ok(errors.some((e) => e.includes('commit 1') && e.includes('empty commit message')));
  assert.ok(errors.some((e) => e.includes('commit 2') && e.includes('no files listed')));
});

test('validateCommits flags a file listed in two commits', () => {
  const errors = validateCommits([
    { message: 'feat(x): a', files: ['shared.ts'] },
    { message: 'fix(x): b', files: ['shared.ts'] },
  ]);

  assert.ok(
    errors.some((e) => e.includes('"shared.ts"') && e.includes('commit 1') && e.includes('commit 2')),
  );
});

test('validateCommits flags a file listed twice in one commit', () => {
  const errors = validateCommits([{ message: 'feat(x): a', files: ['dup.ts', 'dup.ts'] }]);

  assert.ok(errors.some((e) => e.includes('listed more than once')));
});

test('validateCommits returns no errors for valid input', () => {
  assert.deepEqual(
    validateCommits([
      { message: 'feat(x): a', files: ['a.ts'] },
      { message: 'test(x): b', files: ['b.ts'] },
    ]),
    [],
  );
});
