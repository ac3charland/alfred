import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `known-secrets.ts` is duplicated into tools/showboat because the tools can't import each other's
// source. The commit gate and showboat's record-time guard must agree on what a live secret is, so
// the two copies (and their tests) may never drift apart.
const here = path.dirname(fileURLToPath(import.meta.url));
const showboat = path.resolve(here, '../../showboat/src');

describe('known-secrets copies', () => {
  it.each(['known-secrets.ts', 'known-secrets.test.ts'])('%s is identical in showboat', (file) => {
    expect(readFileSync(path.join(showboat, file), 'utf8')).toBe(
      readFileSync(path.join(here, file), 'utf8'),
    );
  });
});
