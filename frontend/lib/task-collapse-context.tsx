'use client';

import * as React from 'react';

type CollapseSubscriber = () => void;

interface TaskCollapseContextValue {
  subscribe: (cb: CollapseSubscriber) => () => void;
}

const noopUnsubscribe = () => void 0;
const noopSubscribe: TaskCollapseContextValue['subscribe'] = () => noopUnsubscribe;
const TaskCollapseContext = React.createContext<TaskCollapseContextValue>({
  subscribe: noopSubscribe,
});

export { TaskCollapseContext };

/** Subscribe a callback to collapse-all events fired by the owning view. */
export function useCollapseSubscription() {
  return React.useContext(TaskCollapseContext).subscribe;
}

/**
 * Returns { subscribe, collapseAll } for the owning view component.
 * Pass subscribe into TaskCollapseContext.Provider; call collapseAll from the button.
 */
export function useCollapseAll() {
  const subscribersRef = React.useRef<Set<CollapseSubscriber>>(new Set());

  const subscribe = React.useCallback((cb: CollapseSubscriber) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const collapseAll = React.useCallback(() => {
    for (const sub of subscribersRef.current) sub();
  }, []);

  return { subscribe, collapseAll };
}
