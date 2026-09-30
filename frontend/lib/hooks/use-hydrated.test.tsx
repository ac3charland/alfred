import { renderHook } from '@testing-library/react';
import * as React from 'react';
import { renderToString } from 'react-dom/server';

import { useHydrated } from './use-hydrated';

function Probe() {
  return <span>{String(useHydrated())}</span>;
}

describe('useHydrated', () => {
  it('is false while rendering on the server', () => {
    expect(renderToString(<Probe />)).toBe('<span>false</span>');
  });

  it('is true in a client render', () => {
    const { result } = renderHook(() => useHydrated());

    expect(result.current).toBe(true);
  });
});
