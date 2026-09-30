/**
 * A stable sort that returns a copy. `unicorn/no-array-sort` forbids the mutating `.sort()`, and
 * `toSorted()` needs ES2023 while this package targets ES2022 — so an explicit insertion loop, as
 * the other tools packages do (see docs/lint-suggestions/unicorn-no-array-sort-vs-tsconfig-lib-es2022.md).
 */
export function sortedBy<T>(items: Iterable<T>, compare: (a: T, b: T) => number): T[] {
  const out: T[] = [];
  for (const item of items) {
    const insertAt = out.findIndex((existing) => compare(existing, item) > 0);
    if (insertAt === -1) out.push(item);
    else out.splice(insertAt, 0, item);
  }
  return out;
}

/** Plain string order (code-unit), for ids, codes and file names. */
export function byString(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
