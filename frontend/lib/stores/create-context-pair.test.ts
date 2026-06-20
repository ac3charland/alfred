import { renderHook } from '@testing-library/react';

import { createContextPair } from './create-context-pair';

describe('createContextPair guard hooks', () => {
  it('falls back to "This hook" in the error when no caller name is supplied', () => {
    const { useStateValue } = createContextPair<{ x: number }, { go: () => void }>('a TestProvider');
    // No hookName argument → the default must read "This hook must be used within …",
    // not an empty prefix.
    expect(() => renderHook(() => useStateValue())).toThrow(
      'This hook must be used within a TestProvider',
    );
  });

  it('prefixes the supplied caller hook name', () => {
    const { useActions } = createContextPair<{ x: number }, { go: () => void }>('a TestProvider');
    expect(() => renderHook(() => useActions('useThing'))).toThrow(
      'useThing must be used within a TestProvider',
    );
  });
});
