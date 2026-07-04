import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';

import { consumeTaskFocus, navigateToTaskAndFocus } from './navigate-to-task';

describe('navigateToTaskAndFocus', () => {
  it('pushes the destination view then fires the row-focus event for the id', () => {
    const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
    const focusIds: string[] = [];
    const listener = (event_: Event) => {
      focusIds.push((event_ as CustomEvent<{ id: string }>).detail.id);
    };
    globalThis.addEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);

    try {
      navigateToTaskAndFocus('t1', '/folders/f1');

      expect(pushState).toHaveBeenCalledWith(null, '', '/folders/f1');
      expect(focusIds).toEqual(['t1']);
    } finally {
      consumeTaskFocus('t1'); // clear the pending target this test set
      globalThis.removeEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);
      pushState.mockRestore();
    }
  });

  it('records a pending focus target that a later-mounting row can claim exactly once', () => {
    const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});

    try {
      navigateToTaskAndFocus('t2', '/folders/f2');

      // Another row isn't the target; the target claims it once, then it's gone.
      expect(consumeTaskFocus('other')).toBe(false);
      expect(consumeTaskFocus('t2')).toBe(true);
      expect(consumeTaskFocus('t2')).toBe(false);
    } finally {
      pushState.mockRestore();
    }
  });
});
