import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('cli.ts', import.meta.url));

/** `import … from 'x'`, `export … from 'x'`, bare `import 'x'` and `import('x')`. */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

/**
 * Every module specifier the source loads at run time. `import type` and `export type` lines are
 * erased by Node's type stripping, so they load nothing.
 */
function runtimeSpecifiers(source: string): string[] {
  const loaded: string[] = [];
  for (const statement of source.match(/^(?:import|export)\b[^;]*?['"][^'"]+['"]/gm) ?? []) {
    if (/^(?:import|export)\s+type\b/.test(statement)) continue;
    for (const match of statement.matchAll(SPECIFIER)) loaded.push(match[2] ?? '');
  }
  return loaded;
}

/** Every file reachable from `entry` through relative imports, and every bare specifier met. */
function walk(entry: string): { files: Set<string>; bare: string[] } {
  const files = new Set<string>();
  const bare: string[] = [];
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) pending.push(path.resolve(path.dirname(file), specifier));
      else if (!specifier.startsWith('node:')) bare.push(`${path.basename(file)}: ${specifier}`);
    }
  }
  return { files, bare };
}

describe('hook import graph', () => {
  it('reaches only node: builtins and relative modules, so a missing node_modules cannot break it', () => {
    const { files, bare } = walk(ENTRY);
    expect(bare).toEqual([]);
    // Guard the walk itself: it must have found the real modules, not stopped at the entry.
    const names = [...files].map((file) => path.basename(file));
    expect(names).toEqual(expect.arrayContaining(['cli.ts', 'run.ts', 'stop.ts', 'replay.ts']));
  });

  it('sees a bare specifier when one is there', () => {
    expect(runtimeSpecifiers(`import x from 'zod';\nimport type { T } from 'y';`)).toEqual(['zod']);
    expect(runtimeSpecifiers(`export { a } from 'pkg';\nexport type { B } from 'other';`)).toEqual([
      'pkg',
    ]);
    expect(runtimeSpecifiers(`import { type T } from 'typed';`)).toEqual(['typed']);
  });
});
