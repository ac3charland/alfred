import { isoWeekWindow } from './week';

describe('isoWeekWindow', () => {
  it('returns the Monday-to-next-Monday window containing a midweek instant', () => {
    // Wednesday 2026-07-22, 15:00 UTC.
    const window = isoWeekWindow(new Date('2026-07-22T15:00:00Z'), 'UTC');

    expect(window).toEqual({
      start: '2026-07-20T00:00:00+00:00',
      end: '2026-07-27T00:00:00+00:00',
      timezone: 'UTC',
    });
  });

  it('puts a Sunday in the week that is ENDING, not the one about to begin', () => {
    // Sunday 2026-07-26, 23:00 UTC — the last hour of the Jul 20 week.
    const window = isoWeekWindow(new Date('2026-07-26T23:00:00Z'), 'UTC');

    expect(window.start).toBe('2026-07-20T00:00:00+00:00');
    expect(window.end).toBe('2026-07-27T00:00:00+00:00');
  });

  it('starts the NEW week the instant Monday midnight arrives', () => {
    const window = isoWeekWindow(new Date('2026-07-27T00:00:00Z'), 'UTC');

    expect(window.start).toBe('2026-07-27T00:00:00+00:00');
    expect(window.end).toBe('2026-08-03T00:00:00+00:00');
  });

  it('anchors the boundary to local midnight in a negative-UTC zone, not to UTC midnight', () => {
    // Monday 2026-07-20 02:00 UTC is still SUNDAY 22:00 in New York, so the window is the
    // week that is ending there — a UTC-based split would have jumped a day ahead.
    const window = isoWeekWindow(new Date('2026-07-20T02:00:00Z'), 'America/New_York');

    expect(window).toEqual({
      start: '2026-07-13T00:00:00-04:00',
      end: '2026-07-20T00:00:00-04:00',
      timezone: 'America/New_York',
    });
  });

  it('anchors the boundary to local midnight in a positive-UTC zone too', () => {
    // Sunday 2026-07-26 23:00 UTC is already MONDAY 09:00 in Sydney — the new week there.
    const window = isoWeekWindow(new Date('2026-07-26T23:00:00Z'), 'Australia/Sydney');

    expect(window.start).toBe('2026-07-27T00:00:00+10:00');
    expect(window.end).toBe('2026-08-03T00:00:00+10:00');
  });

  it('still starts and ends at LOCAL midnight across a spring-forward DST change', () => {
    // US DST starts Sunday 2026-03-08, inside the Mar 2 → Mar 9 week: the offset is -05:00
    // at the start and -04:00 at the end, and both ends stay at 00:00:00 local.
    const window = isoWeekWindow(new Date('2026-03-04T12:00:00Z'), 'America/New_York');

    expect(window.start).toBe('2026-03-02T00:00:00-05:00');
    expect(window.end).toBe('2026-03-09T00:00:00-04:00');
  });

  it('still starts and ends at LOCAL midnight across a fall-back DST change', () => {
    // US DST ends Sunday 2026-11-01, inside the Oct 26 → Nov 2 week.
    const window = isoWeekWindow(new Date('2026-10-28T12:00:00Z'), 'America/New_York');

    expect(window.start).toBe('2026-10-26T00:00:00-04:00');
    expect(window.end).toBe('2026-11-02T00:00:00-05:00');
  });

  it('falls back to UTC for an unrecognized timezone instead of throwing', () => {
    const window = isoWeekWindow(new Date('2026-07-22T15:00:00Z'), 'Not/AZone');

    expect(window).toEqual({
      start: '2026-07-20T00:00:00+00:00',
      end: '2026-07-27T00:00:00+00:00',
      timezone: 'UTC',
    });
  });

  it('falls back to UTC for an empty timezone', () => {
    expect(isoWeekWindow(new Date('2026-07-22T15:00:00Z'), '').timezone).toBe('UTC');
  });

  it('rolls back across a month and year boundary to reach the Monday', () => {
    // Friday 2027-01-01 — the week started Monday 2026-12-28.
    const window = isoWeekWindow(new Date('2027-01-01T12:00:00Z'), 'UTC');

    expect(window.start).toBe('2026-12-28T00:00:00+00:00');
    expect(window.end).toBe('2027-01-04T00:00:00+00:00');
  });
});
