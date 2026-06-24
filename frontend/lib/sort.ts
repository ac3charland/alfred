/**
 * A stable, non-mutating sort: returns a NEW array ordered by `compare`, preserving the input
 * order of equal elements.
 *
 * The project targets ES2022 (no `Array#toSorted`) and `unicorn/no-array-sort` forbids the
 * mutating `Array#sort`, so the result is built with an insertion loop — an element is placed
 * before the first existing element that compares greater, so equal elements never displace an
 * earlier one (a prior-sort tie-break is preserved). The same approach `tree.ts` uses for the
 * subtask forest, lifted to a shared generic helper.
 */
export function stableSorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  const sorted: T[] = [];
  for (const item of items) {
    const insertAt = sorted.findIndex((existing) => compare(existing, item) > 0);
    if (insertAt === -1) sorted.push(item);
    else sorted.splice(insertAt, 0, item);
  }
  return sorted;
}
