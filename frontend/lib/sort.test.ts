import { stableSorted } from './sort';

const byValue = (a: { v: number }, b: { v: number }) => a.v - b.v;

describe('stableSorted', () => {
  it('returns a new array sorted ascending by the comparator', () => {
    const input = [{ v: 3 }, { v: 1 }, { v: 2 }];
    expect(stableSorted(input, byValue).map((x) => x.v)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input array', () => {
    const input = [{ v: 3 }, { v: 1 }];
    stableSorted(input, byValue);
    expect(input.map((x) => x.v)).toEqual([3, 1]);
  });

  it('is stable: equal elements keep their input order', () => {
    const input = [
      { v: 1, id: 'a' },
      { v: 1, id: 'b' },
      { v: 1, id: 'c' },
    ];
    expect(stableSorted(input, byValue).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty array', () => {
    expect(stableSorted([], byValue)).toEqual([]);
  });
});
