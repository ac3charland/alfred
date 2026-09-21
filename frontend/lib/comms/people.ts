import type { CommPersonWithHandles } from '@/lib/types';

/**
 * Handle resolution — the same human is a phone number in iMessage and an email address in
 * three mailboxes, so the roster is keyed on the person and a handle is looked up, never
 * compared raw. Normalisation is the whole of it: `Dana@Example.com `, `+1 (555) 010-2233` and
 * `555-010-2233` all have to land on the stored forms `dana@example.com` and `+15550102233`.
 */

/** North American numbers are written without a country code often enough to be worth assuming. */
const US_NATIONAL_DIGITS = 10;

/**
 * The stored form of a handle: a lower-cased email address, or a phone number in E.164.
 *
 * The country code IS inferred, because the one source whose handles are always phone numbers
 * does the same thing: the Mac daemon canonicalises every iMessage sender to `+1…` before it
 * ever reaches the database, so a person typed in the way a human writes a number
 * (`555-010-2233`) would otherwise never resolve the sender who arrives as `+15550102233` — and
 * adding them to the roster would appear to do nothing at all. A number that is neither ten
 * digits nor eleven starting with `1` is passed through as digits, unreshaped: inventing a
 * country code for a short code or an international number would be a wrong answer rather than
 * a missing one.
 *
 * This rule is stated once in the ALF-244 spec and implemented three times — here,
 * `daemon/src/sources/imessage/normalize.ts` (the reference) and `workers/src/comms/prompt.ts`
 * (the comparison) — following the same deliberate duplication `daemon/src/contract.ts`
 * documents. Change one and change all three, with the mirrored test table in each package.
 */
export function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const digits = trimmed.replaceAll(/\D/g, '');
  if (digits === '') return trimmed.toLowerCase();
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === US_NATIONAL_DIGITS) return `+1${digits}`;
  if (digits.length === US_NATIONAL_DIGITS + 1 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

/**
 * The roster person a handle belongs to, or `undefined` when nobody claims it. Both sides are
 * normalised, so a person listed with `555-010-2233` resolves a message from `+15550102233` and
 * the reverse — the two are one handle, not two.
 */
export function resolvePerson(
  handle: string,
  people: CommPersonWithHandles[],
): CommPersonWithHandles | undefined {
  const wanted = normalizeHandle(handle);
  if (wanted === '') return undefined;
  return people.find((person) =>
    person.comm_handles.some((row) => normalizeHandle(row.handle) === wanted),
  );
}
