import path from 'node:path';

import {
  GENERATED_SCHEMAS,
  TYPES_OUTPUT_PATH,
  assertUsableTypes,
  clusterConnectionString,
  firstDifferingLine,
} from './gen-types.ts';

describe('TYPES_OUTPUT_PATH', () => {
  it('points at the file the frontend imports its Database type from', () => {
    expect(TYPES_OUTPUT_PATH.endsWith(path.join('frontend', 'lib', 'database.types.ts'))).toBe(
      true,
    );
    expect(path.isAbsolute(TYPES_OUTPUT_PATH)).toBe(true);
  });
});

describe('GENERATED_SCHEMAS', () => {
  it('covers public only — the one schema the migrations build', () => {
    expect([...GENERATED_SCHEMAS]).toStrictEqual(['public']);
  });
});

describe('clusterConnectionString', () => {
  it('builds a passwordless libpq URL from the throwaway cluster parts', () => {
    expect(
      clusterConnectionString({
        host: '127.0.0.1',
        port: 5599,
        user: 'postgres',
        database: 'postgres',
      }),
    ).toBe('postgresql://postgres@127.0.0.1:5599/postgres');
  });
});

describe('assertUsableTypes', () => {
  const valid = [
    'export type Json = string',
    '',
    'export type Database = {',
    '  public: {}',
    '}',
  ].join('\n');

  it('accepts output that declares the Database type', () => {
    expect(() => {
      assertUsableTypes(valid);
    }).not.toThrow();
  });

  it('rejects empty output rather than clobbering the committed file', () => {
    expect(() => {
      assertUsableTypes('');
    }).toThrow(/empty/i);
  });

  it('rejects output missing the Database declaration', () => {
    expect(() => {
      assertUsableTypes('export type Json = string\n');
    }).toThrow(/Database/);
  });

  it('rejects output with no public schema — a generator that saw an empty database', () => {
    expect(() => {
      assertUsableTypes('export type Database = {\n}\n');
    }).toThrow(/public/);
  });
});

describe('firstDifferingLine', () => {
  it('returns -1 when the two texts match', () => {
    expect(firstDifferingLine('a\nb\n', 'a\nb\n')).toBe(-1);
  });

  it('reports the 1-based line where they first diverge', () => {
    expect(firstDifferingLine('a\nb\nc\n', 'a\nX\nc\n')).toBe(2);
  });

  it('reports the first extra line when one text is longer', () => {
    expect(firstDifferingLine('a\n', 'a\nb\n')).toBe(2);
  });
});
