import { rollingWeekWindow } from './week';

describe('rollingWeekWindow', () => {
  it('ends at the request instant and starts exactly seven days earlier', () => {
    // Friday 2026-07-24, 16:00 UTC.
    const window = rollingWeekWindow(new Date('2026-07-24T16:00:00Z'), 'UTC');

    expect(window).toEqual({
      start: '2026-07-17T16:00:00+00:00',
      end: '2026-07-24T16:00:00+00:00',
      timezone: 'UTC',
    });
  });

  it('covers the weekend behind a Friday-afternoon request', () => {
    const window = rollingWeekWindow(new Date('2026-07-24T16:00:00Z'), 'UTC');

    // Saturday Jul 18 and Sunday Jul 19 sit inside the window — the very days a
    // Monday-anchored week dropped from a Friday review.
    expect(new Date(window.start).getTime()).toBeLessThan(
      new Date('2026-07-18T00:00:00Z').getTime(),
    );
    expect(new Date(window.end).getTime()).toBeGreaterThan(
      new Date('2026-07-19T23:59:59Z').getTime(),
    );
  });

  it('keeps the request time of day rather than snapping to midnight', () => {
    const window = rollingWeekWindow(new Date('2026-07-22T09:37:14Z'), 'UTC');

    // Floored to the enclosing five-minute bucket, but still mid-morning — not midnight.
    expect(window.start).toBe('2026-07-15T09:35:00+00:00');
    expect(window.end).toBe('2026-07-22T09:35:00+00:00');
  });

  it('gives every instant in one bucket the same window, so the search URL can be cached', () => {
    const first = rollingWeekWindow(new Date('2026-07-22T09:35:00Z'), 'UTC');
    const last = rollingWeekWindow(new Date('2026-07-22T09:39:59Z'), 'UTC');
    const next = rollingWeekWindow(new Date('2026-07-22T09:40:00Z'), 'UTC');

    expect(last).toEqual(first);
    expect(next).not.toEqual(first);
  });

  it('treats Monday like any other day — no jump to a week boundary', () => {
    // Monday 2026-07-27, 00:30 UTC: a Monday-anchored week would have collapsed to a
    // half-hour-old window; the rolling one still reaches back a full seven days.
    const window = rollingWeekWindow(new Date('2026-07-27T00:30:00Z'), 'UTC');

    expect(window.start).toBe('2026-07-20T00:30:00+00:00');
    expect(window.end).toBe('2026-07-27T00:30:00+00:00');
  });

  it('renders both ends as local wall clock carrying the zone offset', () => {
    const window = rollingWeekWindow(new Date('2026-07-24T20:00:00Z'), 'America/New_York');

    expect(window).toEqual({
      start: '2026-07-17T16:00:00-04:00',
      end: '2026-07-24T16:00:00-04:00',
      timezone: 'America/New_York',
    });
  });

  it('renders a positive-UTC zone in its own wall clock too', () => {
    const window = rollingWeekWindow(new Date('2026-07-24T20:00:00Z'), 'Australia/Sydney');

    expect(window.start).toBe('2026-07-18T06:00:00+10:00');
    expect(window.end).toBe('2026-07-25T06:00:00+10:00');
  });

  it('stays a true seven days across a spring-forward DST change', () => {
    // US DST starts Sunday 2026-03-08, between the two ends: the offset is -05:00 at the
    // start and -04:00 at the end, so the local wall clock advances an hour while the span
    // stays 168 hours of real time.
    const window = rollingWeekWindow(new Date('2026-03-11T12:00:00Z'), 'America/New_York');

    expect(window.start).toBe('2026-03-04T07:00:00-05:00');
    expect(window.end).toBe('2026-03-11T08:00:00-04:00');
  });

  it('stays a true seven days across a fall-back DST change', () => {
    // US DST ends Sunday 2026-11-01, between the two ends.
    const window = rollingWeekWindow(new Date('2026-11-04T12:00:00Z'), 'America/New_York');

    expect(window.start).toBe('2026-10-28T08:00:00-04:00');
    expect(window.end).toBe('2026-11-04T07:00:00-05:00');
  });

  it('rolls back across a month and year boundary', () => {
    const window = rollingWeekWindow(new Date('2027-01-01T12:00:00Z'), 'UTC');

    expect(window.start).toBe('2026-12-25T12:00:00+00:00');
    expect(window.end).toBe('2027-01-01T12:00:00+00:00');
  });

  it('truncates sub-second precision, which the search qualifier has no room for', () => {
    const window = rollingWeekWindow(new Date('2026-07-24T16:00:00.789Z'), 'UTC');

    expect(window.start).toBe('2026-07-17T16:00:00+00:00');
    expect(window.end).toBe('2026-07-24T16:00:00+00:00');
  });

  it('falls back to UTC for an unrecognized timezone instead of throwing', () => {
    const window = rollingWeekWindow(new Date('2026-07-24T16:00:00Z'), 'Not/AZone');

    expect(window).toEqual({
      start: '2026-07-17T16:00:00+00:00',
      end: '2026-07-24T16:00:00+00:00',
      timezone: 'UTC',
    });
  });

  it('falls back to UTC for an empty timezone', () => {
    expect(rollingWeekWindow(new Date('2026-07-24T16:00:00Z'), '').timezone).toBe('UTC');
  });
});
