import { type DigestTaskRow, rankDue } from './due';

// The parity table: each case is copied from frontend/lib/tasks/due-today.test.ts (whose clock is
// pinned to 2026-09-06), so the digest and the Today view agree on membership and order.
const TODAY = '2026-09-06';

/** A JSON null, as the RPC sends an empty column — parsed, since the package bans the literal. */
const WIRE_NULL = JSON.parse('null') as null;

let nextCreated = 0;
function task(title: string, overrides: Partial<DigestTaskRow> = {}): DigestTaskRow {
  nextCreated += 1;
  return {
    id: overrides.id ?? title,
    parent_id: overrides.parent_id ?? WIRE_NULL,
    title,
    status: overrides.status ?? 'active',
    priority: overrides.priority ?? WIRE_NULL,
    due_date: overrides.due_date ?? WIRE_NULL,
    due_time: overrides.due_time ?? WIRE_NULL,
    created_at: overrides.created_at ?? `2026-01-0${String(nextCreated)}T00:00:00Z`,
  };
}

const ranked = (rows: DigestTaskRow[], today = TODAY): string[] =>
  rankDue(rows, today).map((row) => row.title);

describe('rankDue — parity with the Today view', () => {
  it('keeps a task due today and one already overdue, and drops future + undated ones', () => {
    expect(
      ranked([
        task('Due today', { due_date: '2026-09-06' }),
        task('Overdue', { due_date: '2026-09-01' }),
        task('Due tomorrow', { due_date: '2026-09-07' }),
        task('No due date', { due_date: WIRE_NULL }),
      ]),
    ).toEqual(['Overdue', 'Due today']);
  });

  it('lists only top-level tasks — a due subtask never becomes its own row', () => {
    expect(
      ranked([
        task('Parent', { id: 'p' }),
        task('Due child', { id: 'c', parent_id: 'p', due_date: '2026-09-06' }),
      ]),
    ).toEqual(['Parent']);
  });

  it('floats an undated parent in on an active descendant due today, at any depth', () => {
    expect(
      ranked([
        task('Grandparent', { id: 'g' }),
        task('Parent', { id: 'p', parent_id: 'g' }),
        task('Grandchild', { id: 'c', parent_id: 'p', due_date: '2026-09-06' }),
      ]),
    ).toEqual(['Grandparent']);
  });

  it('ignores a COMPLETED descendant due date — a finished subtask is not still due', () => {
    expect(
      ranked([
        task('Parent', { id: 'p' }),
        task('Done child', {
          id: 'c',
          parent_id: 'p',
          due_date: '2026-09-01',
          status: 'completed',
        }),
      ]),
    ).toEqual([]);
  });

  it('hides a completed top-level task, and the active subtree beneath it', () => {
    expect(
      ranked([
        task('Done today', { due_date: '2026-09-06', status: 'completed' }),
        task('Done parent', { id: 'dp', status: 'completed' }),
        task('Active child of a done parent', {
          parent_id: 'dp',
          due_date: '2026-09-01',
        }),
      ]),
    ).toEqual([]);
  });

  it('treats a row whose parent is absent as a root, as buildTree does', () => {
    expect(ranked([task('Orphan', { parent_id: 'gone', due_date: '2026-09-06' })])).toEqual([
      'Orphan',
    ]);
  });

  it('puts the most overdue first, then today', () => {
    expect(
      ranked([
        task('Today', { due_date: '2026-09-06' }),
        task('Two days late', { due_date: '2026-09-04' }),
        task('A week late', { due_date: '2026-08-30' }),
      ]),
    ).toEqual(['A week late', 'Two days late', 'Today']);
  });

  it('breaks a same-date tie by priority, not the other way round', () => {
    expect(
      ranked([
        task('Low but overdue', { due_date: '2026-09-01', priority: 'low' }),
        task('High but due today', { due_date: '2026-09-06', priority: 'high' }),
        task('Unprioritised, overdue', { due_date: '2026-09-01', priority: WIRE_NULL }),
      ]),
    ).toEqual(['Low but overdue', 'Unprioritised, overdue', 'High but due today']);
  });

  it('ranks a rolled-up parent by the earliest active due date in its subtree', () => {
    expect(
      ranked([
        task('Own date today', { id: 'a', due_date: '2026-09-06' }),
        task('Child is late', { id: 'b' }),
        task('Late child', { id: 'bc', parent_id: 'b', due_date: '2026-08-30' }),
      ]),
    ).toEqual(['Child is late', 'Own date today']);
  });

  it('falls back on created_at when date and priority both tie', () => {
    expect(
      ranked([
        task('Second', { due_date: '2026-09-06', created_at: '2026-02-02T00:00:00Z' }),
        task('First', { due_date: '2026-09-06', created_at: '2026-02-01T00:00:00Z' }),
      ]),
    ).toEqual(['First', 'Second']);
  });

  it('runs a day by time, the untimed task last whatever its priority', () => {
    expect(
      ranked([
        task('Water the plants', { due_date: '2026-09-06', priority: 'high' }),
        task('Pick up dry cleaning', {
          due_date: '2026-09-06',
          due_time: '17:30:00',
          priority: 'low',
        }),
        task('Call the dentist', { due_date: '2026-09-06', due_time: '15:00:00' }),
        task('Send standup notes', {
          due_date: '2026-09-06',
          due_time: '09:00:00',
          priority: 'high',
        }),
        task('Renew passport', { due_date: '2026-09-05', priority: 'medium' }),
      ]),
    ).toEqual([
      'Renew passport',
      'Send standup notes',
      'Call the dentist',
      'Pick up dry cleaning',
      'Water the plants',
    ]);
  });

  it('keeps a timed task due later today in the list before its time', () => {
    expect(ranked([task('Tonight', { due_date: '2026-09-06', due_time: '23:00' })])).toEqual([
      'Tonight',
    ]);
  });

  it('reads "today" from the argument, not the machine clock', () => {
    const rows = [task('Due the 10th', { due_date: '2026-09-10' })];
    expect(ranked(rows, '2026-09-09')).toEqual([]);
    expect(ranked(rows, '2026-09-10')).toEqual(['Due the 10th']);
  });
});

const label = (rows: DigestTaskRow[]): (string | undefined)[] =>
  rankDue(rows, TODAY).map((row) => row.label?.text);

describe('rankDue — labels', () => {
  it('counts the days late off the task’s own date, singular for one', () => {
    expect(
      label([task('A', { due_date: '2026-09-04' }), task('B', { due_date: '2026-09-05' })]),
    ).toEqual(['2 days late', '1 day late']);
  });

  it('says "subtask late" when the late date comes from a subtask', () => {
    const rows = rankDue(
      [
        task('Parent', { id: 'p', due_date: '2026-09-05' }),
        task('Late child', { parent_id: 'p', due_date: '2026-09-01' }),
      ],
      TODAY,
    );
    expect(rows.map((row) => row.label)).toEqual([{ text: 'subtask late', late: true }]);
  });

  it('shows its own time when due today with one, and nothing when untimed', () => {
    expect(
      label([
        task('Timed', { due_date: '2026-09-06', due_time: '15:00:00' }),
        task('Untimed', { due_date: '2026-09-06' }),
      ]),
    ).toEqual(['3:00 PM', undefined]);
  });

  it('says "subtask due" when only a subtask is due today', () => {
    expect(
      label([
        task('Parent', { id: 'p', due_date: '2026-09-09' }),
        task('Child', { parent_id: 'p', due_date: '2026-09-06', due_time: '09:00' }),
      ]),
    ).toEqual(['subtask due']);
  });

  it('keeps its own time when a subtask is due earlier the same day', () => {
    expect(
      label([
        task('Parent', { id: 'p', due_date: '2026-09-06', due_time: '15:00' }),
        task('Child', { parent_id: 'p', due_date: '2026-09-06', due_time: '09:00' }),
      ]),
    ).toEqual(['3:00 PM']);
  });

  it('marks lateness, and only lateness, as late', () => {
    const rows = rankDue(
      [
        task('Late', { due_date: '2026-09-01' }),
        task('Timed', { due_date: '2026-09-06', due_time: '08:00' }),
      ],
      TODAY,
    );
    expect(rows.map((row) => row.label)).toEqual([
      { text: '5 days late', late: true },
      { text: '8:00 AM', late: false },
    ]);
  });
});
