import { stableSorted } from '@/lib/sort';
import type { ReaderPublicationListItem } from '@/lib/types';

/** Substack's own platform sender (the weekly stats digest) — never a roster entry, so it is
 * excluded by name rather than matched against the roster. */
const SUBSTACK_STATS_HANDLE = 'no-reply@substack.com';

const SUBSTACK_DOMAIN = 'substack.com';

/** The domain of a handle, lower-cased — `substack.com` out of `harborline@substack.com`. */
function domainOf(handle: string): string {
  return handle.slice(handle.indexOf('@') + 1).toLowerCase();
}

/**
 * The Gmail filter query that keeps the owner's hand-maintained inbox rule matched to the
 * roster, over every ENABLED handle. Pasted straight into the "From" field of Gmail's
 * create-filter dialog, which already scopes the field to `from:` — so the query itself carries
 * no `from:` prefix of its own; pasting one would double it into `from:from:(…)`.
 *
 * Substack handles collapse into one wildcard-domain clause, `*@substack.com AND
 * -no-reply@substack.com`, rather than being listed individually: the roster's Substack side only
 * grows, so a per-handle term made the query longer with every new subscription, and Substack's
 * own stats digest is excluded by name so it stays in the inbox. Every other publication keeps
 * its exact handle — `*@theirdomain.com` would also catch senders on the same domain the roster
 * never claimed.
 *
 * Terms are ordered alphabetically by domain, then by handle, so the string is stable across
 * renders and diffable across pastes into gmail.com/settings/filters.
 */
export function gmailFilterQuery(publications: ReaderPublicationListItem[]): string | null {
  const enabledHandles = publications
    .filter((publication) => publication.enabled)
    .map((row) => row.handle);

  if (enabledHandles.length === 0) return null;

  const hasSubstack = enabledHandles.some((handle) => domainOf(handle) === SUBSTACK_DOMAIN);
  const otherHandles = stableSorted(
    enabledHandles.filter((handle) => domainOf(handle) !== SUBSTACK_DOMAIN),
    (a, b) => domainOf(a).localeCompare(domainOf(b)) || a.localeCompare(b),
  );

  const clauses = hasSubstack
    ? [`*@${SUBSTACK_DOMAIN} AND -${SUBSTACK_STATS_HANDLE}`, ...otherHandles]
    : otherHandles;

  return clauses.join(' OR ');
}
