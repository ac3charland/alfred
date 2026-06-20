/**
 * Build a PATCH update payload (`Partial<T>`, e.g. an `ItemUpdate`) from a validated body,
 * copying only the fields the caller actually provided.
 *
 * Replaces the `if (d.x !== undefined) updates.x = d.x` loops in the items/epics/code
 * PATCH handlers. A field is copied iff its value is not `undefined`, so a present
 * `null` is preserved (it clears a nullable column); an absent field is skipped.
 *
 * `data` is typed so each requested field may be its `T` value OR `undefined` — that's the
 * shape a Zod `.optional()` parse yields (`string | null | undefined`). Skipping `undefined`
 * narrows each copied value back to `T[K]`, which `exactOptionalPropertyTypes` requires (a
 * DB `Update` column is `string | null`, never `undefined`).
 */
export function toUpdatePayload<T>(
  data: { [K in keyof T]?: T[K] | undefined },
  fieldNames: (keyof T)[],
): Partial<T> {
  const updates: Partial<T> = {};
  for (const field of fieldNames) {
    const value = data[field];
    if (value !== undefined) {
      updates[field] = value;
    }
  }
  return updates;
}
