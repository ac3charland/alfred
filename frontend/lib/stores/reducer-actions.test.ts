import { type SimpleAction, insertAt, keyedReducer, simpleReducer } from './reducer-actions';

interface Row {
  id: string;
  value: string;
}

const A: Row = { id: 'a', value: 'A' };
const B: Row = { id: 'b', value: 'B' };
const C: Row = { id: 'c', value: 'C' };

describe('simpleReducer', () => {
  it('insert appends a row', () => {
    expect(simpleReducer([A], { type: 'insert', item: B }, 'row')).toStrictEqual([A, B]);
  });

  it('replace swaps a single row by id, and is a no-op for an absent id', () => {
    const renamed = { ...A, value: 'A2' };
    expect(simpleReducer([A], { type: 'replace', id: 'a', item: renamed }, 'row')).toStrictEqual([
      renamed,
    ]);
    expect(simpleReducer([A], { type: 'replace', id: 'gone', item: renamed }, 'row')).toStrictEqual(
      [A],
    );
  });

  it('replace never leaves two rows sharing the resulting key, keeping the replaced slot', () => {
    // A replace can retarget a row's key (an optimistic temp id swapped for the server's real
    // id on reconcile). If that real id already landed elsewhere in the array by some other
    // path (e.g. a background refetch upserting the same server row before the reconcile ran),
    // the OTHER copy is dropped — the replaced row keeps ITS slot, not the other copy's, so
    // array order (capture order) is unaffected.
    const tempRow = { id: 'temp-1', value: 'optimistic' };
    const alreadyLanded = { id: 'server-1', value: 'from refetch' };
    const reconciled = { id: 'server-1', value: 'from reconcile' };

    const result = simpleReducer(
      [tempRow, alreadyLanded],
      { type: 'replace', id: 'temp-1', item: reconciled },
      'row',
    );

    expect(result).toStrictEqual([reconciled]);
  });

  it('replace with an unchanged key never touches another row, even one sharing that key', () => {
    // The common case (id and item.id are the same) must stay untouched by the de-dup — a row
    // elsewhere in the array sharing that key (an existing, unrelated duplicate) is not this
    // action's concern, and the fast path must not go looking for it.
    const first = { id: 'a', value: 'first' };
    const second = { id: 'a', value: 'second' };
    const renamed = { id: 'a', value: 'renamed' };

    const result = simpleReducer(
      [first, second],
      { type: 'replace', id: 'a', item: renamed },
      'row',
    );

    expect(result).toStrictEqual([renamed, second]);
  });

  it('patch merges into every id in the set (race rule: absent ids skipped)', () => {
    const result = simpleReducer(
      [A, B],
      { type: 'patch', ids: ['a', 'b'], patch: { value: 'x' } },
      'row',
    );
    expect(result.map((r) => r.value)).toStrictEqual(['x', 'x']);
    expect(
      simpleReducer([A], { type: 'patch', ids: ['gone'], patch: { value: 'x' } }, 'row'),
    ).toStrictEqual([A]);
  });

  it('upsert replaces present rows and appends missing ones', () => {
    const A2 = { ...A, value: 'A2' };
    expect(simpleReducer([A], { type: 'upsert', items: [A2, C] }, 'row')).toStrictEqual([A2, C]);
  });

  it('remove drops every id in the set', () => {
    expect(simpleReducer([A, B], { type: 'remove', ids: ['a'] }, 'row')).toStrictEqual([B]);
  });

  it('throws via assertNever for an unknown action type, naming the context', () => {
    expect(() =>
      simpleReducer([A], { type: 'unknown' } as unknown as SimpleAction<Row>, 'row action'),
    ).toThrow('Unhandled row action');
  });
});

describe('insertAt', () => {
  it('inserts at the given index, preserving items after it', () => {
    expect(insertAt([B], A, 0)).toStrictEqual([A, B]);
    expect(insertAt([A, C], B, 1)).toStrictEqual([A, B, C]);
    expect(insertAt([A, B], C, 2)).toStrictEqual([A, B, C]);
  });

  it('clamps negative indices to 0', () => {
    expect(insertAt([A, B], C, -1)).toStrictEqual([C, A, B]);
  });

  it('clamps out-of-bounds indices to the array length', () => {
    expect(insertAt([A, B], C, 99)).toStrictEqual([A, B, C]);
  });
});

describe('keyedReducer', () => {
  interface Keyed {
    handle: string;
    count: number;
  }

  const LOUD: Keyed = { handle: 'loud@example.com', count: 3 };
  const QUIET: Keyed = { handle: 'quiet@example.com', count: 1 };
  const keyOf = (row: Keyed): string => row.handle;

  it('patches by the key it was given rather than by an id column', () => {
    expect(
      keyedReducer(
        [LOUD, QUIET],
        { type: 'patch', ids: ['loud@example.com'], patch: { count: 9 } },
        'candidate',
        keyOf,
      ),
    ).toStrictEqual([{ handle: 'loud@example.com', count: 9 }, QUIET]);
  });

  it('removes and replaces by that same key', () => {
    expect(
      keyedReducer(
        [LOUD, QUIET],
        { type: 'remove', ids: ['quiet@example.com'] },
        'candidate',
        keyOf,
      ),
    ).toStrictEqual([LOUD]);

    const renamed = { handle: 'loud@example.com', count: 4 };
    expect(
      keyedReducer(
        [LOUD],
        { type: 'replace', id: 'loud@example.com', item: renamed },
        'candidate',
        keyOf,
      ),
    ).toStrictEqual([renamed]);
  });

  it('upserts on the key, replacing a match and appending the rest', () => {
    const louder = { handle: 'loud@example.com', count: 12 };
    expect(
      keyedReducer([LOUD], { type: 'upsert', items: [louder, QUIET] }, 'candidate', keyOf),
    ).toStrictEqual([louder, QUIET]);
  });
});
