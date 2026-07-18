import {
  CORE_TABLES,
  MIN_DUMP_BYTES,
  assertCoreTables,
  assertDumpSize,
  assertInstanceName,
  backupKeys,
  dailyKey,
  missingCoreTables,
  monthlyKey,
  utcDateStamp,
  utcMonthStamp,
} from './backup.ts';

describe('utcDateStamp', () => {
  it('formats a date as UTC YYYY-MM-DD, zero-padding month and day', () => {
    expect(utcDateStamp(new Date('2026-07-17T12:00:00.000Z'))).toBe('2026-07-17');
    expect(utcDateStamp(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-01-05');
  });

  it('reads the UTC calendar day, not the local one, near a day boundary', () => {
    // 23:30 UTC is still the 17th in UTC even though it is already the 18th in +02:00.
    expect(utcDateStamp(new Date('2026-07-17T23:30:00.000Z'))).toBe('2026-07-17');
  });
});

describe('utcMonthStamp', () => {
  it('formats a date as UTC YYYY-MM, zero-padding the month', () => {
    expect(utcMonthStamp(new Date('2026-07-17T12:00:00.000Z'))).toBe('2026-07');
    expect(utcMonthStamp(new Date('2026-01-31T12:00:00.000Z'))).toBe('2026-01');
  });
});

describe('dailyKey / monthlyKey / backupKeys', () => {
  const when = new Date('2026-07-17T08:17:00.000Z');

  it('nests the instance under the daily/ tier so one lifecycle rule covers every instance', () => {
    expect(dailyKey('personal', when)).toBe('daily/personal/2026-07-17.sql.gz');
    expect(dailyKey('work', when)).toBe('daily/work/2026-07-17.sql.gz');
  });

  it('nests the instance under the monthly/ tier', () => {
    expect(monthlyKey('personal', when)).toBe('monthly/personal/2026-07.sql.gz');
    expect(monthlyKey('work', when)).toBe('monthly/work/2026-07.sql.gz');
  });

  it('returns both keys for an instance so one verified dump lands in two slots', () => {
    expect(backupKeys('work', when)).toStrictEqual({
      daily: 'daily/work/2026-07-17.sql.gz',
      monthly: 'monthly/work/2026-07.sql.gz',
    });
  });
});

describe('assertInstanceName', () => {
  it('accepts lowercase instance tokens', () => {
    expect(() => {
      assertInstanceName('personal');
    }).not.toThrow();
    expect(() => {
      assertInstanceName('work');
    }).not.toThrow();
    expect(() => {
      assertInstanceName('staging-2');
    }).not.toThrow();
  });

  it('rejects a name that could reshape the object key or is empty', () => {
    expect(() => {
      assertInstanceName('');
    }).toThrow(/invalid INSTANCE/);
    expect(() => {
      assertInstanceName('work/../personal');
    }).toThrow(/invalid INSTANCE/);
    expect(() => {
      assertInstanceName('Personal');
    }).toThrow(/invalid INSTANCE/);
  });
});

describe('assertDumpSize', () => {
  it('accepts a dump at or above the floor', () => {
    expect(() => {
      assertDumpSize(MIN_DUMP_BYTES);
    }).not.toThrow();
    expect(() => {
      assertDumpSize(MIN_DUMP_BYTES + 1);
    }).not.toThrow();
  });

  it('rejects an empty or truncated dump below the floor', () => {
    expect(() => {
      assertDumpSize(0);
    }).toThrow(/implausibly small/);
    expect(() => {
      assertDumpSize(MIN_DUMP_BYTES - 1);
    }).toThrow(/implausibly small/);
  });

  it('honours a caller-supplied floor', () => {
    expect(() => {
      assertDumpSize(50, 100);
    }).toThrow(/implausibly small/);
    expect(() => {
      assertDumpSize(150, 100);
    }).not.toThrow();
  });
});

describe('missingCoreTables / assertCoreTables', () => {
  it('reports no missing tables when every core table is present', () => {
    expect(missingCoreTables([...CORE_TABLES, 'epics', 'code_items'])).toStrictEqual([]);
    expect(() => {
      assertCoreTables([...CORE_TABLES]);
    }).not.toThrow();
  });

  it('lists exactly the core tables that are absent', () => {
    expect(missingCoreTables(['items'])).toStrictEqual(['folders', 'projects']);
  });

  it('throws naming the missing tables when a restore is not structurally sound', () => {
    expect(() => {
      assertCoreTables(['items', 'folders']);
    }).toThrow(/projects/);
    expect(() => {
      assertCoreTables([]);
    }).toThrow(/items, folders, projects/);
  });
});
