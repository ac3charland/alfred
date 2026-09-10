import { DEFAULT_LOOKBACK_DAYS, resumeFrom } from './cursor.ts';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('resumeFrom', () => {
  it('prefers the server cursor over the local one', () => {
    const resume = resumeFrom({
      serverCursor: { rowid: 900 },
      localCursor: { rowid: 12 },
      now: NOW,
    });

    expect(resume.cursor).toEqual({ rowid: 900 });
  });

  it('falls back to the local cursor when the server has none', () => {
    const resume = resumeFrom({ localCursor: { rowid: 12 }, now: NOW });

    expect(resume.cursor).toEqual({ rowid: 12 });
  });

  it('reports no cursor when neither side has one', () => {
    expect(resumeFrom({ now: NOW }).cursor).toBeUndefined();
  });

  it('anchors on a seven-day lookback when the account has never polled', () => {
    const resume = resumeFrom({ now: NOW });

    expect(resume.anchor).toEqual(new Date(NOW.getTime() - DEFAULT_LOOKBACK_DAYS * DAY_MS));
  });

  it('honours a caller-supplied lookback', () => {
    const resume = resumeFrom({ now: NOW, lookbackDays: 2 });

    expect(resume.anchor).toEqual(new Date(NOW.getTime() - 2 * DAY_MS));
  });

  it('anchors on the last successful poll even when it is older than the lookback window', () => {
    // The worked example. An outage begins on day 7 and is fixed on day 17: the last successful
    // poll is day 7, so the anchor is day 7 and the ten missing days are ingested. Taking the
    // LATER of the two anchors — max(day 7, day 10) — would silently drop days 7–10, which is the
    // exact false negative this rule exists to prevent.
    const dayZero = new Date('2026-01-01T00:00:00.000Z').getTime();
    const daySeven = new Date(dayZero + 7 * DAY_MS);
    const daySeventeen = new Date(dayZero + 17 * DAY_MS);

    const resume = resumeFrom({ serverLastSeenAt: daySeven, now: daySeventeen });

    expect(resume.anchor).toEqual(daySeven);
    expect(resume.anchor.getTime()).toBeLessThan(daySeventeen.getTime() - 7 * DAY_MS);
  });

  it('still anchors on the last poll when it is inside the window', () => {
    const anHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);

    expect(resumeFrom({ serverLastSeenAt: anHourAgo, now: NOW }).anchor).toEqual(anHourAgo);
  });
});
