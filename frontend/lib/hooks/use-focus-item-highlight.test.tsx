import { act, render, screen } from '@testing-library/react';
import * as React from 'react';

import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';
import { useFocusItemHighlight } from '@/lib/hooks/use-focus-item-highlight';

function Probe({ id }: { id: string }) {
  const { ref, highlighted } = useFocusItemHighlight<HTMLDivElement>(id);
  return (
    <div ref={ref} data-testid="probe" data-highlighted={highlighted}>
      row
    </div>
  );
}

function fireFocusItem(id: string) {
  act(() => {
    globalThis.dispatchEvent(new CustomEvent(ALFRED_FOCUS_ITEM_EVENT, { detail: { id } }));
  });
}

describe('useFocusItemHighlight', () => {
  it('highlights only when the event names this row, then fades after a delay', () => {
    jest.useFakeTimers();
    try {
      render(<Probe id="me" />);
      const probe = screen.getByTestId('probe');
      expect(probe).toHaveAttribute('data-highlighted', 'false');

      fireFocusItem('someone-else');
      expect(probe).toHaveAttribute('data-highlighted', 'false');

      fireFocusItem('me');
      expect(probe).toHaveAttribute('data-highlighted', 'true');

      act(() => {
        jest.runAllTimers();
      });
      expect(probe).toHaveAttribute('data-highlighted', 'false');
    } finally {
      jest.useRealTimers();
    }
  });
});
