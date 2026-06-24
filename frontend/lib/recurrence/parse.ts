/**
 * Bridge a stored JSONB value (the `items.recurrence` column, typed `Json | null`) into a typed
 * {@link RecurrenceRule}, returning `null` for an absent or malformed rule. Validates through the
 * same Zod schema the API boundary uses, so every reader (the row chip, the meta-panel control,
 * the optimistic store) agrees on what counts as a valid rule.
 */
import { recurrenceSchema } from '@/lib/api/schemas';

import type { RecurrenceRule } from './types';

export function parseRecurrenceRule(value: unknown): RecurrenceRule | null {
  if (value === null || value === undefined) return null;
  const parsed = recurrenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
