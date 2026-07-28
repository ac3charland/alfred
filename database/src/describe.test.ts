import { describe, expect, it } from '@jest/globals';

import { formatColumns } from './describe.ts';

describe('formatColumns', () => {
  it('aligns the type column against the longest name', () => {
    expect(
      formatColumns([
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'entry_date', data_type: 'date', is_nullable: 'NO' },
      ]),
    ).toEqual(['  id          uuid not null', '  entry_date  date not null']);
  });

  it('marks a nullable column by saying nothing, and carries a default when there is one', () => {
    expect(
      formatColumns([
        { column_name: 'note', data_type: 'text', is_nullable: 'YES' },
        {
          column_name: 'created_at',
          data_type: 'timestamp with time zone',
          is_nullable: 'NO',
          column_default: 'now()',
        },
      ]),
    ).toEqual([
      '  note        text',
      '  created_at  timestamp with time zone not null default now()',
    ]);
  });

  it('handles an empty table without dividing by an empty width', () => {
    expect(formatColumns([])).toEqual([]);
  });
});
