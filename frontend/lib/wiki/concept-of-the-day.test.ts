import { addDays } from '@/lib/date-utils';
import { stableSorted } from '@/lib/sort';
import type { WikiPageIndexRow } from '@/lib/types';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';
import { type WikiSection, wikiPagePath } from '@/lib/wiki/sections';

import { conceptOfTheDay, fnv1a32 } from './concept-of-the-day';

/** An index row in `section`, dated `created` (null for a page with no date at all). */
function page(section: WikiSection, stem: string, created: string | null): WikiPageIndexRow {
  return toWikiIndexRow(makeWikiPage(wikiPagePath(section, stem), { created }));
}

function concept(stem: string, created: string | null = '2026-01-01'): WikiPageIndexRow {
  return page('concepts', stem, created);
}

/** `n` concepts named `c00`, `c01`, … all created on `created`. */
function concepts(n: number, created: string | null = '2026-01-01'): WikiPageIndexRow[] {
  return Array.from({ length: n }, (_, index) =>
    concept(`c${String(index).padStart(2, '0')}`, created),
  );
}

/** `count` consecutive dates starting at `from`. */
function days(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

/** The path each of `dates` features, in order; fails the test on a day with no pick. */
function picks(pages: readonly WikiPageIndexRow[], dates: readonly string[]): string[] {
  return dates.map((date) => {
    const pick = conceptOfTheDay(pages, date);
    if (pick === undefined) throw new Error(`no concept on ${date}`);
    return pick.path;
  });
}

/** The path with the lowest hash for `date` among `pages` — the tie-break, spelled out. */
function lowestHash(pages: readonly WikiPageIndexRow[], date: string): string {
  const [first] = stableSorted(
    pages,
    (a, b) => fnv1a32(`${date}|${a.path}`) - fnv1a32(`${date}|${b.path}`),
  );
  if (first === undefined) throw new Error('no pages');
  return first.path;
}

/** Whether `created` is a real `YYYY-MM-DD` date — the slow way, by round trip. */
function isValidDate(created: string | null): created is string {
  return created !== null && /^\d{4}-\d{2}-\d{2}$/.test(created) && addDays(created, 0) === created;
}

/**
 * The definition, written the slow way: each day, filter the concepts that qualify, then take
 * the one featured longest ago (never featured first, by lowest hash, then path).
 */
function naiveConceptOfTheDay(
  pages: readonly WikiPageIndexRow[],
  today: string,
): string | undefined {
  const all = pages.filter((row) => row.section === 'concepts');
  const [earliest] = stableSorted(all.map((row) => row.created).filter(isValidDate), (a, b) =>
    a < b ? -1 : 1,
  );
  const start = earliest !== undefined && earliest < today ? earliest : today;

  const lastFeatured = new Map<string, number>();
  let result: string | undefined;
  let index = 0;
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const qualifying = all.filter((row) => !isValidDate(row.created) || row.created < day);
    const pool = qualifying.length > 0 ? qualifying : all;
    const [best] = stableSorted(pool, (a, b) => {
      const aLast = lastFeatured.get(a.path) ?? -1;
      const bLast = lastFeatured.get(b.path) ?? -1;
      if (aLast !== bLast) return aLast - bLast;
      const byHash = fnv1a32(`${day}|${a.path}`) - fnv1a32(`${day}|${b.path}`);
      if (byHash !== 0) return byHash;
      return a.path < b.path ? -1 : 1;
    });
    if (best === undefined) return undefined;
    lastFeatured.set(best.path, index);
    result = best.path;
    index += 1;
  }
  return result;
}

/** A small deterministic PRNG so the "random" wiki is the same on every run. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 25 concepts created across 60 days from 2026-01-10, some of them undated or malformed. */
function seededWiki(seed: number, withUndated: boolean): WikiPageIndexRow[] {
  const random = mulberry32(seed);
  return Array.from({ length: 25 }, (_, index) => {
    const created = addDays('2026-01-10', Math.floor(random() * 60));
    if (withUndated && index % 6 === 0) return concept(`seeded-${String(index)}`, null);
    if (withUndated && index % 11 === 5) return concept(`seeded-${String(index)}`, 'soon');
    return concept(`seeded-${String(index)}`, created);
  });
}

describe('fnv1a32', () => {
  it.each([
    ['', 0x81_1c_9d_c5],
    ['a', 0xe4_0c_29_2c],
    ['foobar', 0xbf_9c_f9_68],
  ])('hashes %j to the reference FNV-1a value', (text, expected) => {
    expect(fnv1a32(text)).toBe(expected);
  });

  it('answers an unsigned 32-bit integer', () => {
    // 'a' hashes with the top bit set, which a signed `^` / `Math.imul` result would report negative.
    expect(fnv1a32('a')).toBeGreaterThan(0x7f_ff_ff_ff);
    expect(fnv1a32('2026-03-01|wiki/concepts/x.md')).toBe(0xf5_b2_34_a9);
  });

  it('reads a non-ASCII string one code point at a time, an emoji as a single step', () => {
    expect(fnv1a32('é')).toBe(0x6c_0b_6c_44);
    expect(fnv1a32('\u{1F600}')).toBe(0x06_50_a7_1f);
  });
});

describe('conceptOfTheDay', () => {
  describe('which pages are candidates', () => {
    it('is undefined for an empty wiki', () => {
      expect(conceptOfTheDay([], '2026-03-01')).toBeUndefined();
    });

    it('never picks an entity, a source or a question', () => {
      const wiki = [
        page('entities', 'james-clear', '2026-01-01'),
        page('sources', 'atomic-habits', '2026-01-01'),
        page('questions', 'how-long', '2026-01-01'),
      ];

      expect(conceptOfTheDay(wiki, '2026-03-01')).toBeUndefined();
    });

    it('picks the concept in a wiki of one concept among other sections, every day', () => {
      const only = concept('habit-loop');
      const wiki = [
        page('entities', 'james-clear', '2025-01-01'),
        only,
        page('sources', 'atomic-habits', '2025-01-01'),
      ];

      expect(picks(wiki, days('2026-03-01', 10))).toEqual(
        Array.from({ length: 10 }, () => only.path),
      );
    });

    it('is undefined for a date that is not a calendar date, rather than replaying forever', () => {
      expect(conceptOfTheDay(concepts(3), 'soon')).toBeUndefined();
      expect(conceptOfTheDay(concepts(3), '2026-13-45')).toBeUndefined();
      expect(conceptOfTheDay(concepts(3), '')).toBeUndefined();
    });
  });

  describe('purity', () => {
    it('answers the same for the same input, every time', () => {
      const wiki = concepts(9);
      const first = picks(wiki, days('2026-03-01', 20));

      expect(picks(wiki, days('2026-03-01', 20))).toEqual(first);
    });

    it('answers the same for an equal wiki in a new array, in any order', () => {
      const late = ['d00', 'd01', 'd02', 'd03'].map((stem) => concept(stem, '2026-02-10'));
      const wiki = [...concepts(9), ...late];
      const shuffled = stableSorted(wiki, (a, b) => (a.path < b.path ? 1 : -1));
      const rotated = [...wiki.slice(5), ...wiki.slice(0, 5)];
      const dates = days('2026-02-01', 40);

      expect(picks(shuffled, dates)).toEqual(picks(wiki, dates));
      expect(picks(rotated, dates)).toEqual(picks(wiki, dates));
    });

    it('steps one calendar day at a time across DST changes and a year end', () => {
      // A skipped or repeated date anywhere in the replay would break the once-per-round
      // guarantee for the runs that straddle it.
      const window = picks(concepts(5), days('2026-03-01', 400));

      for (let start = 0; start + 5 <= window.length; start += 1) {
        expect(new Set(window.slice(start, start + 5)).size).toBe(5);
      }
    });

    it('memoises on the pages array and the date', () => {
      const wiki = concepts(6);
      const before = conceptOfTheDay(wiki, '2026-03-01');

      // A caller must treat the array as immutable (the store hands out a new one per change);
      // emptying it in place shows the same array and date come from the cache, and another
      // date is still computed fresh.
      wiki.length = 0;

      expect(conceptOfTheDay(wiki, '2026-03-01')).toBe(before);
      expect(conceptOfTheDay(wiki, '2026-03-02')).toBeUndefined();
    });
  });

  describe('the rotation', () => {
    it.each([1, 2, 3, 7, 12])(
      'features each of %i settled concepts once in every run of that many days',
      (n) => {
        const wiki = concepts(n);
        const window = picks(wiki, days('2026-03-01', 30));

        for (let start = 0; start + n <= window.length; start += 1) {
          const run = window.slice(start, start + n);
          expect(new Set(run).size).toBe(n);
        }
      },
    );

    it('repeats the same order every round once every concept has been featured', () => {
      const window = picks(concepts(7), days('2026-03-01', 28));

      expect(window.slice(7, 14)).toEqual(window.slice(0, 7));
      expect(window.slice(14, 21)).toEqual(window.slice(0, 7));
      expect(window.slice(21, 28)).toEqual(window.slice(0, 7));
    });

    it('gives two different concepts on two consecutive dates, across midnight', () => {
      for (const n of [2, 3, 7]) {
        const wiki = concepts(n);
        const window = picks(wiki, days('2026-12-20', 30));

        for (let index = 1; index < window.length; index += 1) {
          expect(window[index]).not.toBe(window[index - 1]);
        }
      }
    });

    it('gives two different concepts across a year end', () => {
      const [dec31, jan1] = picks(concepts(2), ['2026-12-31', '2027-01-01']);

      expect(dec31).not.toBe(jan1);
    });

    it('breaks a tie between never-featured concepts by the lowest hash of the date and path', () => {
      const wiki = concepts(5);
      const firstDay = '2026-01-01';
      const secondDay = addDays(firstDay, 1);
      const [firstPick, secondPick] = picks(wiki, [firstDay, secondDay]);

      expect(firstPick).toBe(lowestHash(wiki, firstDay));
      expect(secondPick).toBe(
        lowestHash(
          wiki.filter((row) => row.path !== firstPick),
          secondDay,
        ),
      );
    });

    it('features the longest-ago concept once none is left unfeatured', () => {
      const wiki = concepts(4);
      const [first, second, third, fourth] = picks(wiki, days('2026-01-01', 4));

      expect(conceptOfTheDay(wiki, '2026-01-05')?.path).toBe(first);
      expect(conceptOfTheDay(wiki, '2026-01-06')?.path).toBe(second);
      expect(conceptOfTheDay(wiki, '2026-01-07')?.path).toBe(third);
      expect(conceptOfTheDay(wiki, '2026-01-08')?.path).toBe(fourth);
    });
  });

  describe('a concept that has just arrived', () => {
    const today = '2026-03-10';

    it('does not change the pick of the day it was created', () => {
      const settled = concepts(5);
      const arrived = concept('just-in', today);

      expect(conceptOfTheDay([...settled, arrived], today)?.path).toBe(
        conceptOfTheDay(settled, today)?.path,
      );
    });

    it('is featured the next day, before any concept repeats', () => {
      const settled = concepts(5);
      const arrived = concept('just-in', today);

      const window = picks([...settled, arrived], days(today, 7));

      expect(window[0]).toBe(picks(settled, [today])[0]);
      expect(window[1]).toBe(arrived.path);
      // Today's pick, the newcomer, then the rest of the round: no path twice until the round ends.
      expect(new Set(window).size).toBe(6);
    });

    it('is featured with a second newcomer before either older concept repeats', () => {
      const settled = concepts(4);
      const arrived = [concept('new-a', today), concept('new-b', today)];

      const window = picks([...settled, ...arrived], days(today, 3));

      expect(window[0]).toBe(picks(settled, [today])[0]);
      expect(new Set(window.slice(1))).toEqual(new Set(arrived.map((row) => row.path)));
    });

    it('is featured the day after its date, ahead of every settled concept', () => {
      const settled = concepts(3);
      const dayBefore = addDays(today, -1);
      const arrived = concept('just-in', dayBefore);

      // Created yesterday, so it qualifies today and, never featured, goes first.
      expect(conceptOfTheDay([...settled, arrived], today)?.path).toBe(arrived.path);
    });
  });

  describe('a created date that does not qualify', () => {
    it.each([
      ['null', null],
      ['an impossible date', '2026-13-45'],
      ['a date that does not exist', '2026-02-30'],
      ['prose', 'soon'],
      ['an empty string', ''],
      ['a compact date', '20260101'],
      ['a timestamp', '2026-01-01T00:00:00Z'],
      ['year zero', '0000-01-01'],
    ])('counts as always having existed when it is %s', (_label, created) => {
      const ancient = concept('ancient', created);
      const future = concept('future', '2026-06-01');
      const window = picks([future, ancient], days('2026-03-01', 5));

      // Only the always-existing page qualifies until the other one's date has passed.
      expect(window).toEqual(Array.from({ length: 5 }, () => ancient.path));
    });

    it('does not set where the replay starts', () => {
      const undated = concept('undated', 'soon');
      const dated = concept('dated', '2026-03-01');

      // Day 1: only the undated page qualifies. Day 2: the dated one joins, never featured.
      expect(picks([undated, dated], ['2026-03-01', '2026-03-02', '2026-03-03'])).toEqual([
        undated.path,
        dated.path,
        undated.path,
      ]);
    });

    it('keeps a concept created in the future out until the day after its date', () => {
      const settled = concept('settled');
      const future = concept('future', '2026-03-05');
      const window = picks([settled, future], days('2026-03-01', 6));

      expect(window.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => settled.path));
      expect(window[5]).toBe(future.path);
    });

    it('still picks when every concept is dated in the future', () => {
      const wiki = concepts(4, '2026-09-01');

      expect(conceptOfTheDay(wiki, '2026-03-01')?.path).toBe(lowestHash(wiki, '2026-03-01'));
    });
  });

  describe("the wiki's first day", () => {
    it('picks a concept although none has qualified yet, by lowest hash', () => {
      const wiki = concepts(6, '2026-03-01');

      expect(conceptOfTheDay(wiki, '2026-03-01')?.path).toBe(lowestHash(wiki, '2026-03-01'));
    });

    it('moves on to a different concept the next day, and features all before a repeat', () => {
      const wiki = concepts(6, '2026-03-01');
      const window = picks(wiki, days('2026-03-01', 6));

      expect(new Set(window).size).toBe(6);
    });

    it('may feature a concept dated later, which then waits out its own date', () => {
      // Build a wiki whose first-day winner is dated three days after the other concept, so the
      // winner is featured before it qualifies and must not come back until it does.
      const [alpha, beta] = concepts(2, '2026-03-01');
      if (alpha === undefined || beta === undefined) throw new Error('fixture');
      const firstDay = '2026-03-01';
      const winnerPath = lowestHash([alpha, beta], firstDay);
      const winner = { ...(winnerPath === alpha.path ? alpha : beta), created: '2026-03-04' };
      const other = winnerPath === alpha.path ? beta : alpha;

      const window = picks([winner, other], days(firstDay, 6));

      expect(window).toEqual([
        winner.path, // the first day: nothing qualifies, so both are considered
        other.path,
        other.path, // the winner is not dated yet, so the other repeats
        other.path,
        winner.path, // created the 4th, qualifies from the 5th, featured longest ago
        other.path,
      ]);
    });
  });

  describe('replaying history', () => {
    it.each([1, 2, 3, 4, 5, 6])(
      'agrees day for day with a slow scan of every concept (seed %i, some undated)',
      (seed) => {
        const wiki = seededWiki(seed, true);
        // Starts before the first date and runs well past the last, so both the days before the
        // wiki began and the settled rotation are compared.
        const dates = days('2026-01-01', 120);

        expect(dates.map((date) => conceptOfTheDay(wiki, date)?.path)).toEqual(
          dates.map((date) => naiveConceptOfTheDay(wiki, date)),
        );
      },
    );

    it.each([11, 12, 13, 14, 15, 16, 17, 18])(
      'agrees day for day with a slow scan when every concept is dated (seed %i)',
      (seed) => {
        const wiki = seededWiki(seed, false);
        const dates = days('2026-01-01', 120);

        expect(dates.map((date) => conceptOfTheDay(wiki, date)?.path)).toEqual(
          dates.map((date) => naiveConceptOfTheDay(wiki, date)),
        );
      },
    );

    it('agrees with a slow scan when other sections are mixed in', () => {
      const wiki = [
        ...seededWiki(21, true),
        page('entities', 'someone', '2026-01-01'),
        page('sources', 'a-book', null),
        page('questions', 'why', '2026-02-01'),
      ];
      const dates = days('2026-02-01', 60);

      expect(dates.map((date) => conceptOfTheDay(wiki, date)?.path)).toEqual(
        dates.map((date) => naiveConceptOfTheDay(wiki, date)),
      );
    });

    it.each([
      ['created across forty days', 40],
      ['all created on one day, so every one waits in the set at first', 1],
    ])('replays ten years of a 200-concept wiki quickly, %s', (_label, spread) => {
      const wiki = Array.from({ length: 200 }, (_, index) =>
        concept(`perf-${String(index)}`, addDays('2016-10-01', index % spread)),
      );
      const today = addDays('2016-10-01', 3650);

      const startedAt = performance.now();
      const pick = conceptOfTheDay(wiki, today);
      const elapsed = performance.now() - startedAt;

      expect(pick).toBeDefined();
      expect(elapsed).toBeLessThan(500);
    });
  });
});
