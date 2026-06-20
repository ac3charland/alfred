import { renderHook } from '@testing-library/react';
import * as React from 'react';

import { createContextPair } from './create-context-pair';

interface State {
  count: number;
}
interface Actions {
  increment: () => void;
}

function makePair() {
  return createContextPair<State, Actions>('an ExampleProvider');
}

describe('createContextPair', () => {
  it('returns the value provided to the state context inside a provider', () => {
    const { StateContext, useStateValue } = makePair();
    const state: State = { count: 7 };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    );

    const { result } = renderHook(() => useStateValue(), { wrapper });

    expect(result.current).toBe(state);
  });

  it('returns the value provided to the actions context inside a provider', () => {
    const { ActionsContext, useActions } = makePair();
    const actions: Actions = { increment: () => {} };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    );

    const { result } = renderHook(() => useActions(), { wrapper });

    expect(result.current).toBe(actions);
  });

  it('throws the displayName message when the state hook is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { useStateValue } = makePair();
    expect(() => renderHook(() => useStateValue())).toThrow(
      /must be used within an ExampleProvider/,
    );
    spy.mockRestore();
  });

  it('throws the displayName message when the actions hook is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { useActions } = makePair();
    expect(() => renderHook(() => useActions())).toThrow(/must be used within an ExampleProvider/);
    spy.mockRestore();
  });

  it('prefixes the throw message with the caller-supplied hook name', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { useStateValue } = makePair();
    expect(() => renderHook(() => useStateValue('useExample'))).toThrow(
      'useExample must be used within an ExampleProvider',
    );
    spy.mockRestore();
  });

  it('falls back to a generic hook-name prefix when none is supplied', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { useActions } = makePair();
    expect(() => renderHook(() => useActions())).toThrow(
      'This hook must be used within an ExampleProvider',
    );
    spy.mockRestore();
  });

  it('falls back to the generic prefix for the state hook too (not just actions)', () => {
    // The state hook has its own `hookName = 'This hook'` default; assert the full prefix so
    // emptying that default is caught (the displayName-only check above would miss it).
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { useStateValue } = makePair();
    expect(() => renderHook(() => useStateValue())).toThrow(
      'This hook must be used within an ExampleProvider',
    );
    spy.mockRestore();
  });
});
