// parse.mjs — pure parsing + validation for the batch-commits input format.
//
// No I/O lives here (no git, npm, or filesystem) so this logic can be
// unit-tested directly. The orchestrator (batch-commit.mjs) imports these.

const MESSAGE_PREFIX = 'message:';

/**
 * Parse the block-text batch input into an ordered list of commits.
 *
 * Format:
 *   - a line whose trimmed text starts with `message:` begins a new commit;
 *     the rest of that line is its single-line subject;
 *   - following non-blank lines are file paths for the current commit (the
 *     whole trimmed line, so paths may contain spaces);
 *   - blank lines separate groups;
 *   - lines whose trimmed text starts with `#` are comments.
 *
 * @param {string} text
 * @returns {{ commits: { message: string, files: string[] }[] }}
 */
export function parseBatchInput(text) {
  const commits = [];
  let current = null;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;

    if (line.startsWith(MESSAGE_PREFIX)) {
      current = { message: line.slice(MESSAGE_PREFIX.length).trim(), files: [] };
      commits.push(current);
      return;
    }

    if (current === null) {
      throw new Error(
        `line ${index + 1}: file path "${line}" appears before any "${MESSAGE_PREFIX}" line`,
      );
    }
    current.files.push(line);
  });

  return { commits };
}

/**
 * Validate the semantic shape of the parsed commits. Returns a list of
 * human-readable error strings; an empty array means the input is valid.
 *
 * @param {{ message: string, files: string[] }[]} commits
 * @returns {string[]}
 */
export function validateCommits(commits) {
  const errors = [];

  if (commits.length === 0) {
    errors.push('no commits found (expected at least one "message:" block)');
    return errors;
  }

  commits.forEach((commit, i) => {
    const n = i + 1;
    if (commit.message === '') errors.push(`commit ${n}: empty commit message`);
    if (commit.files.length === 0) errors.push(`commit ${n}: no files listed`);
  });

  // A file may belong to at most one commit: whole-file staging cannot split a
  // single file's changes across commits.
  const seen = new Map(); // file -> first commit number (1-based)
  commits.forEach((commit, i) => {
    const n = i + 1;
    for (const file of commit.files) {
      if (seen.has(file)) {
        const first = seen.get(file);
        errors.push(
          first === n
            ? `commit ${n}: file "${file}" is listed more than once`
            : `file "${file}" is listed in commit ${first} and commit ${n}; a file can only belong to one commit`,
        );
      } else {
        seen.set(file, n);
      }
    }
  });

  return errors;
}
