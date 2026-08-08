import {
  CORE_TABLES,
  MIN_DUMP_BYTES,
  assertCoreTables,
  assertDumpSize,
  assertInstanceName,
  backupExitCode,
  backupKeys,
  backupSummaryLine,
  copiedTables,
  dailyKey,
  describeSchemaDrift,
  missingCoreTables,
  monthlyKey,
  reconcileDriftStatements,
  schemaDrift,
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

describe('copiedTables', () => {
  it('reads the quoted COPY header the Supabase CLI’s pg_dump emits', () => {
    const dump = `COPY "public"."items" ("id", "title", "dispatched_at") FROM stdin;
1\tfirst\t\\N
\\.
`;
    expect(copiedTables(dump)).toStrictEqual([
      { table: 'items', columns: ['id', 'title', 'dispatched_at'] },
    ]);
  });

  it('reads the unquoted COPY header a plain pg_dump emits', () => {
    const dump = `COPY public.folders (id, name) FROM stdin;
1\tHealth
\\.
`;
    expect(copiedTables(dump)).toStrictEqual([{ table: 'folders', columns: ['id', 'name'] }]);
  });

  it('reads every table in dump order', () => {
    const dump = `COPY public.folders (id) FROM stdin;
1
\\.

COPY public.items (id, title) FROM stdin;
2\tsecond
\\.
`;
    expect(copiedTables(dump).map((copied) => copied.table)).toStrictEqual(['folders', 'items']);
  });

  it('does not mistake a data row that starts with COPY for a header', () => {
    // A captured task really can be titled "COPY public.items (id) FROM stdin;" — inside a COPY
    // block every line is data until the `\.` terminator, so the parser must not re-parse it.
    const dump = `COPY public.items (id, title) FROM stdin;
1\tCOPY public.evil (id, boom) FROM stdin;
\\.
`;
    expect(copiedTables(dump)).toStrictEqual([{ table: 'items', columns: ['id', 'title'] }]);
  });

  it('returns nothing for a dump with no COPY sections', () => {
    expect(copiedTables("SELECT pg_catalog.set_config('search_path', '', false);\n")).toStrictEqual(
      [],
    );
  });
});

describe('schemaDrift', () => {
  it('reports nothing when the schema carries every column the dump does', () => {
    const present = new Map([['items', ['id', 'title']]]);
    expect(schemaDrift([{ table: 'items', columns: ['id', 'title'] }], present)).toStrictEqual([]);
  });

  it('reports nothing when the SCHEMA is ahead — the repo may hold migrations an instance lacks', () => {
    // A dump taken between a merge and its migrate job, or against an instance whose migrate job
    // failed, is short a column. COPY defaults the rest; not drift, and must not fail a backup.
    const present = new Map([['items', ['id', 'title', 'dispatched_at']]]);
    expect(schemaDrift([{ table: 'items', columns: ['id', 'title'] }], present)).toStrictEqual([]);
  });

  it('reports a column production has that the repo’s migrations do not', () => {
    const present = new Map([['items', ['id', 'title']]]);
    expect(
      schemaDrift([{ table: 'items', columns: ['id', 'title', 'dispatched_at'] }], present),
    ).toStrictEqual([{ table: 'items', columns: ['dispatched_at'], absent: false }]);
  });

  it('reports a whole table production has that the repo’s migrations do not', () => {
    expect(schemaDrift([{ table: 'habits', columns: ['id', 'name'] }], new Map())).toStrictEqual([
      { table: 'habits', columns: ['id', 'name'], absent: true },
    ]);
  });

  it('keeps the dump’s column order so the report reads like the dump', () => {
    const present = new Map([['items', ['id']]]);
    expect(schemaDrift([{ table: 'items', columns: ['id', 'b', 'a'] }], present)).toStrictEqual([
      { table: 'items', columns: ['b', 'a'], absent: false },
    ]);
  });
});

describe('describeSchemaDrift', () => {
  it('names each drifted table and its columns', () => {
    const message = describeSchemaDrift([
      { table: 'items', columns: ['dispatched_at'], absent: false },
      { table: 'habits', columns: ['id', 'name'], absent: true },
    ]);
    expect(message).toMatch(/items: dispatched_at/);
    expect(message).toMatch(/habits \(whole table\): id, name/);
  });

  it('sends the reader to the causes that survive migrate-on-merge, not to “go commit it”', () => {
    // migrate.yml applies on merge, so a missing commit is no longer the likely cause — pointing
    // there would send the operator looking in the wrong place.
    const message = describeSchemaDrift([
      { table: 'items', columns: ['dispatched_at'], absent: false },
    ]);
    expect(message).toMatch(/re-run replaying an older pinned commit/);
    expect(message).toMatch(/merge land mid-dump/);
    expect(message).toMatch(/reverted, or DDL applied by hand/);
  });
});

describe('reconcileDriftStatements', () => {
  it('adds a drifted column so the dump’s data still loads and can be counted', () => {
    expect(
      reconcileDriftStatements([{ table: 'items', columns: ['dispatched_at'], absent: false }]),
    ).toStrictEqual(['alter table public."items" add column "dispatched_at" text']);
  });

  it('emits one ALTER per drifted column, so a multi-column migration reconciles too', () => {
    expect(
      reconcileDriftStatements([{ table: 'items', columns: ['a', 'b'], absent: false }]),
    ).toStrictEqual([
      'alter table public."items" add column "a" text',
      'alter table public."items" add column "b" text',
    ]);
  });

  it('creates a whole table the repo’s migrations never declared', () => {
    expect(
      reconcileDriftStatements([{ table: 'habits', columns: ['id', 'name'], absent: true }]),
    ).toStrictEqual(['create table public."habits" ("id" text, "name" text)']);
  });

  it('refuses an identifier that could break out of its quoting', () => {
    expect(() =>
      reconcileDriftStatements([{ table: 'items', columns: ['a" , "b'], absent: false }]),
    ).toThrow(/identifier/);
  });
});

describe('backupExitCode / backupSummaryLine', () => {
  const drifted = [{ table: 'items', columns: ['dispatched_at'], absent: false }];

  it('is green, and says so, when the repo could rebuild everything the dump carried', () => {
    expect(backupExitCode([])).toBe(0);
    expect(backupSummaryLine([])).toBe('✓ backup complete');
  });

  it('is RED on drift, and says the backup was uploaded anyway', () => {
    // The pairing that matters: the artifact reaches R2 (no lost backup) and the run still fails,
    // so GitHub emails the owner. Both halves have to show up in the closing line.
    expect(backupExitCode(drifted)).toBe(1);
    expect(backupSummaryLine(drifted)).toMatch(/backup uploaded/);
    expect(backupSummaryLine(drifted)).toMatch(/production is ahead/);
  });

  it('does not prescribe a remedy in the closing line — that is the drift report’s job', () => {
    // "commit the migration" was right under apply-then-commit and went stale the moment
    // migrate.yml started applying on merge. The line names what happened and points up.
    expect(backupSummaryLine(drifted)).not.toMatch(/commit the migration/);
    expect(backupSummaryLine(drifted)).toMatch(/see the drift report above/);
  });
});

describe('reconcileDriftStatements identifier guard', () => {
  it('refuses a table name that could break out of its quoting', () => {
    expect(() =>
      reconcileDriftStatements([{ table: 'it"ems', columns: ['a'], absent: false }]),
    ).toThrow(/identifier/);
  });
});
