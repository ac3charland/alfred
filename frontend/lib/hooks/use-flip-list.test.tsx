import { render, renderHook } from '@testing-library/react';
import * as React from 'react';

import { useFlipList } from './use-flip-list';

describe('useFlipList', () => {
  it('returns a stable ref-callback per key across renders', () => {
    const { result, rerender } = renderHook(({ keys }) => useFlipList(keys), {
      initialProps: { keys: ['a', 'b'] },
    });
    const first = result.current('a');
    rerender({ keys: ['b', 'a'] });
    // Same key → same callback identity (no detach/reattach churn on reorder).
    expect(result.current('a')).toBe(first);
    expect(result.current('b')).not.toBe(first);
  });

  it('mounts, registers rows, and reorders without throwing (no layout in jsdom)', () => {
    function List({ keys }: { keys: string[] }) {
      const register = useFlipList(keys);
      return (
        <ul>
          {keys.map((key) => (
            <li key={key} ref={register(key)}>
              {key}
            </li>
          ))}
        </ul>
      );
    }
    const { rerender, getAllByRole } = render(<List keys={['a', 'b', 'c']} />);
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
    // A reorder triggers the FLIP layout effect; jsdom has no layout, so it just no-ops.
    expect(() => {
      rerender(<List keys={['c', 'a', 'b']} />);
    }).not.toThrow();
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual(['c', 'a', 'b']);
  });
});
