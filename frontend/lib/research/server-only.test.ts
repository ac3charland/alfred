/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Everything in this folder handles the research Routine's fire token or the delivery key, so
 * none of it may ever be bundled into the browser. `import 'server-only'` is what makes a Client
 * Component importing any of it fail the build; this pins that every module here carries it,
 * including one added later.
 */
describe('lib/research', () => {
  const folder = __dirname;
  const modules = readdirSync(folder).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );

  it('has modules to check', () => {
    expect(modules).toEqual(expect.arrayContaining(['config.ts']));
  });

  it.each(modules)('%s imports server-only', (name) => {
    const source = readFileSync(path.join(folder, name), 'utf8');
    expect(source).toMatch(/^import 'server-only';$/m);
  });
});
