import type { CommPersonWithHandles } from '@/lib/types';

/**
 * Handle resolution — the same human is a phone number in iMessage and an email address in
 * three mailboxes, so the roster is keyed on the person and a handle is looked up, never
 * compared raw. Normalisation is the whole of it: `Dana@Example.com ` and `+1 (555) 010-2233`
 * have to land on the stored forms `dana@example.com` and `+15550102233`.
 */

/**
 * The stored form of a handle: a lower-cased email address, or a phone number as digits with
 * its leading `+` if it had one. An address is anything containing `@`; everything else is
 * treated as a phone number, which is what strips the punctuation people paste in.
 */
export function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const digits = trimmed.replaceAll(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/**
 * The roster person a handle belongs to, or `undefined` when nobody claims it. Both sides are
 * normalised, so a person listed with `+1 (555) 010-2233` still resolves a message from
 * `+15550102233`. A country code is real information and is NOT inferred: a bare
 * `5550102233` and a `+15550102233` stay different handles.
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
