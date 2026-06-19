import * as React from 'react';

/**
 * Build the state + actions context pair every store hand-rolls: two contexts (a data
 * context and a stable-actions context, split so mutate-only components don't re-render on
 * data changes — see the data-flow skill) and the two guard hooks that read them and throw
 * outside a provider.
 *
 * `displayName` is the provider phrase, with its article, that follows "must be used within"
 * (e.g. `'a TasksProvider'`, `'an ActiveEditorProvider'`). Each guard hook prefixes the
 * message with the calling hook's name when the store passes one (e.g. `useTasks`), so the
 * thrown text reads `useTasks must be used within a TasksProvider`.
 */
export function createContextPair<State, Actions>(
  displayName: string,
): {
  StateContext: React.Context<State | undefined>;
  ActionsContext: React.Context<Actions | undefined>;
  useStateValue: (hookName?: string) => State;
  useActions: (hookName?: string) => Actions;
} {
  const StateContext = React.createContext<State | undefined>(undefined);
  const ActionsContext = React.createContext<Actions | undefined>(undefined);

  function useStateValue(hookName = 'This hook'): State {
    const context = React.useContext(StateContext);
    if (context === undefined) {
      throw new Error(`${hookName} must be used within ${displayName}`);
    }
    return context;
  }

  function useActions(hookName = 'This hook'): Actions {
    const context = React.useContext(ActionsContext);
    if (context === undefined) {
      throw new Error(`${hookName} must be used within ${displayName}`);
    }
    return context;
  }

  return { StateContext, ActionsContext, useStateValue, useActions };
}
