import { addDays, daysBetween, eachDay, isoWeekday, todayIn } from '@/lib/habits/dates';

describe('todayIn', () => {
  it('resolves the calendar date in the named zone, not the machine zone', () => {
    // 03:30 UTC on the 28th is still the 27th in New York (UTC-4) and already the 28th in Tokyo.
    const instant = new Date('2026-07-28T03:30:00Z');
    expect(todayIn('America/New_York', instant)).toBe('2026-07-27');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-07-28');
    expect(todayIn('UTC', instant)).toBe('2026-07-28');
  });

  it('rolls a negative-offset zone over its own midnight, not UTC midnight', () => {
    expect(todayIn('America/New_York', new Date('2026-07-28T03:59:00Z'))).toBe('2026-07-27');
    expect(todayIn('America/New_York', new Date('2026-07-28T04:01:00Z'))).toBe('2026-07-28');
  });

  it('rolls a positive-offset zone over its own midnight', () => {
    expect(todayIn('Asia/Tokyo', new Date('2026-07-27T14:59:00Z'))).toBe('2026-07-27');
    expect(todayIn('Asia/Tokyo', new Date('2026-07-27T15:01:00Z'))).toBe('2026-07-28');
  });

  it('reads the correct local date across a DST transition', () => {
    // US DST ends 2026-11-01 at 02:00 local. 05:30 UTC is 01:30 EDT — still the 1st.
    expect(todayIn('America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
    expect(todayIn('America/New_York', new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
  });

  it('falls back to UTC on an unknown zone rather than throwing', () => {
    const instant = new Date('2026-07-28T03:30:00Z');
    expect(todayIn('Mars/Olympus_Mons', instant)).toBe('2026-07-28');
    expect(todayIn('', instant)).toBe('2026-07-28');
  });
});

describe('isoWeekday', () => {
  it('numbers Monday as 1 and Sunday as 7', () => {
    expect(isoWeekday('2026-07-27')).toBe(1);
    expect(isoWeekday('2026-07-28')).toBe(2);
    expect(isoWeekday('2026-08-02')).toBe(7);
  });
});

describe('addDays', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('crosses a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is unaffected by a DST transition — these are calendar days, not instants', () => {
    // A naive instant + 24h across the US spring-forward lands back on the same local date.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('eachDay', () => {
  it('is inclusive of both ends', () => {
    expect(eachDay('2026-07-27', '2026-07-29')).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });

  it('returns a single day when the ends match, and nothing when they are reversed', () => {
    expect(eachDay('2026-07-27', '2026-07-27')).toEqual(['2026-07-27']);
    expect(eachDay('2026-07-29', '2026-07-27')).toEqual([]);
  });
});

describe('daysBetween', () => {
  it('counts whole days in either direction', () => {
    expect(daysBetween('2026-07-27', '2026-08-03')).toBe(7);
    expect(daysBetween('2026-08-03', '2026-07-27')).toBe(-7);
    expect(daysBetween('2026-07-27', '2026-07-27')).toBe(0);
  });
});
