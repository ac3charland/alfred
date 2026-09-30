import { addDays, fromUtcMillis, toUtcMillis } from '@/lib/date-utils';
import { stableSorted } from '@/lib/sort';
import type { WikiPageIndexRow } from '@/lib/types';

/**
 * The wiki landing's "Concept of the day": one concept page featured per calendar day, rotating
 * through all of them before any repeats.
 *
 * The rotation is *least recently featured, replayed*. Nothing is stored: the pick for a date is
 * a pure function of the page index and that date, found by replaying every day since the wiki's
 * first concept and asking each day which qualifying concept was featured longest ago. Every
 * device that holds the same index therefore agrees without a sync, and a page that arrives later
 * simply takes its turn in the rotation from the day after it was created.
 */

/** The 32-bit FNV-1a offset basis. */
const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;

/** The 32-bit FNV-1a prime. */
const FNV_PRIME = 0x01_00_01_93;

/**
 * `Math.imul`, bound once: the replay multiplies hundreds of thousands of times, and a global
 * lookup per call is many times slower than a local one wherever the global is a proxy (a
 * sandboxed test environment, say) — enough to turn milliseconds into tens of them.
 */
const imul = Math.imul;

/** The Unicode code points of `text`, in order (a surrogate pair is one code point). */
function codePoints(text: string): number[] {
  // A non-empty character always has a code point; the fallback only satisfies the type.
  return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

/**
 * Continue an FNV-1a hash from `hash` through `codes`, one xor-then-multiply per code point.
 * `imul` keeps the multiply in 32 bits. The result is left signed, as `^` and `imul` make
 * it; callers turn it unsigned with `>>> 0` once they are done folding.
 */
function fold(hash: number, codes: readonly number[]): number {
  let state = hash;
  for (const code of codes) {
    state ^= code;
    state = imul(state, FNV_PRIME);
  }
  return state;
}

/**
 * The 32-bit FNV-1a hash of `text`, as an unsigned integer. It reads the string one Unicode code
 * point at a time (never a lone half of a surrogate pair), which for ASCII text is the same as
 * hashing its bytes. Every date and every wiki page path (a slug) is ASCII, so those hashes match
 * the published FNV-1a reference values; a non-ASCII path hashes differently from its UTF-8 bytes,
 * which is harmless because every device runs this same function and the hash only orders
 * concepts that are tied. The final `>>> 0` turns the signed result into an unsigned one, so that
 * "lowest hash" compares as an unsigned number everywhere.
 */
export function fnv1a32(text: string): number {
  return fold(FNV_OFFSET_BASIS, codePoints(text)) >>> 0;
}

/** A concept as the replay tracks it. */
interface Candidate {
  page: WikiPageIndexRow;
  /** The page path's code points, read once so the daily hashing is a plain numeric loop. */
  pathCodes: readonly number[];
  /** The page's `created` date, or `undefined` when it is null or not a real `YYYY-MM-DD`. */
  created: string | undefined;
  /** Whether the replay has already featured this concept on some earlier day. */
  featured: boolean;
}

/** A candidate whose `created` date is known, for the list the replay feeds from. */
type DatedCandidate = Candidate & { created: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `value` is a real calendar date written `YYYY-MM-DD`. The shape alone is not enough
 * (`2026-13-45` rolls over into a later real date), so the date must also survive a round trip
 * through the UTC-field helpers unchanged.
 */
function isCalendarDate(value: string | null): value is string {
  return value !== null && ISO_DATE.test(value) && fromUtcMillis(toUtcMillis(value)) === value;
}

/**
 * The candidate whose hash of `day|path` (`fnv1a32(`${day}|${path}`)`) is lowest, or `undefined`
 * for none. FNV-1a folds its input in order, so the hash of `day|` is folded once and each path
 * continues from it. A hash collision (a one-in-four-billion tie) falls back to the path, so the
 * answer never depends on the order the candidates arrive in.
 */
function lowestHash(candidates: Iterable<Candidate>, day: string): Candidate | undefined {
  const dayHash = fold(FNV_OFFSET_BASIS, codePoints(`${day}|`));
  let best: Candidate | undefined;
  let bestHash = 0;
  for (const candidate of candidates) {
    const hash = fold(dayHash, candidate.pathCodes) >>> 0;
    if (
      best === undefined ||
      hash < bestHash ||
      (hash === bestHash && candidate.page.path < best.page.path)
    ) {
      best = candidate;
      bestHash = hash;
    }
  }
  return best;
}

/** Order candidates by `created`, oldest first. */
function byCreated(a: DatedCandidate, b: DatedCandidate): number {
  if (a.created < b.created) return -1;
  if (a.created > b.created) return 1;
  return 0;
}

/**
 * The concept featured on `today`, replaying the rotation day by day from the earliest date any
 * concept was created (or from `today` alone, when that has not happened yet).
 *
 * A concept qualifies on a day once its `created` date is strictly before that day, so a page that
 * syncs mid-day never changes that day's pick; one with no usable date has always qualified. Each
 * day takes the qualifying concept featured longest ago, and a concept never featured goes first.
 * That is done with two structures rather than a scan of every concept per day: a set of the
 * qualifying concepts never featured (fed from the concepts in order of `created` as their dates
 * pass) and a queue of the featured ones, oldest first. A day takes the set's lowest hash when
 * the set has any, otherwise the queue's head, and the pick goes to the queue's tail.
 *
 * The one day nothing can qualify is the first, when no concept is dated before it and none is
 * undated, so every concept is considered. Its winner may be dated after that day, in which case
 * it is *parked* rather than queued: it does not qualify again until its own date has passed,
 * and then, having been featured before any other concept, it rejoins at the head of the queue.
 * This is the only place a concept that does not qualify can be in the rotation. It cannot arise
 * later, because the concept the replay started from is qualifying by the next day.
 */
function replay(
  concepts: readonly WikiPageIndexRow[],
  today: string,
): WikiPageIndexRow | undefined {
  const candidates: Candidate[] = concepts.map((page) => ({
    page,
    pathCodes: codePoints(page.path),
    created: isCalendarDate(page.created) ? page.created : undefined,
    featured: false,
  }));
  const dated = stableSorted(
    candidates.filter((candidate): candidate is DatedCandidate => candidate.created !== undefined),
    byCreated,
  );

  const earliest = dated[0]?.created;
  const start = earliest !== undefined && earliest < today ? earliest : today;

  const neverFeatured = new Set(candidates.filter((candidate) => candidate.created === undefined));
  const queue: Candidate[] = [];
  let head = 0;
  let parked: Candidate | undefined;
  let fed = 0;

  for (let day = start; ; day = addDays(day, 1)) {
    let arriving = dated[fed];
    while (arriving !== undefined && arriving.created < day) {
      if (!arriving.featured) neverFeatured.add(arriving);
      fed += 1;
      arriving = dated[fed];
    }
    if (parked?.created !== undefined && parked.created < day) {
      queue.splice(head, 0, parked);
      parked = undefined;
    }

    let pick = lowestHash(neverFeatured, day);
    if (pick === undefined) {
      pick = queue[head];
      if (pick === undefined) {
        // Nothing qualifies: every concept stands in.
        pick = lowestHash(candidates, day);
        if (pick === undefined) return undefined;
        parked = pick;
      } else {
        head += 1;
        queue.push(pick);
      }
    } else {
      neverFeatured.delete(pick);
      queue.push(pick);
    }
    pick.featured = true;

    if (day === today) return pick.page;
  }
}

/** The pick for each date asked of a pages array: the array is a store snapshot, never mutated. */
const cache = new WeakMap<readonly WikiPageIndexRow[], Map<string, WikiPageIndexRow | undefined>>();

/**
 * The concept featured on `today` (a local `YYYY-MM-DD`), or `undefined` when the wiki has no
 * concepts (or `today` is not a real date, which would otherwise have no last day to replay to).
 *
 * Only concept pages are candidates: entities, sources and questions are never featured. The
 * answer is memoised on the `pages` array and the date, so a render that asks again costs a map
 * lookup; the store hands out a new array whenever the index changes, which is what makes the
 * array's identity a sound key. Ten years of a 200-concept wiki replay in well under 100 ms.
 */
export function conceptOfTheDay(
  pages: readonly WikiPageIndexRow[],
  today: string,
): WikiPageIndexRow | undefined {
  let byDate = cache.get(pages);
  if (byDate === undefined) {
    byDate = new Map();
    cache.set(pages, byDate);
  }
  if (byDate.has(today)) return byDate.get(today);

  const pick = isCalendarDate(today)
    ? replay(
        pages.filter((page) => page.section === 'concepts'),
        today,
      )
    : undefined;
  byDate.set(today, pick);
  return pick;
}
