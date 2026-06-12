import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { InboxScreen } from './inbox-screen';

// Stub the children — they are exercised by their own tests. Here we only care
// about the screen's own toggle + reveal logic.
jest.mock('./capture-box', () => ({
  CaptureBox: function MockCaptureBox() {
    return <div data-testid="capture-box" />;
  },
}));

// Capture the last-rendered scope so tests can assert on it.
let lastTaskListScope: unknown;
jest.mock('./task-list', () => ({
  TaskList: function MockTaskList({
    emptyMessage,
    scope,
  }: {
    emptyMessage?: string;
    scope?: unknown;
  }) {
    lastTaskListScope = scope;
    return <div data-testid="task-list">{emptyMessage}</div>;
  },
}));

/** Force a `prefers-reduced-motion` result for the duration of a test. */
function mockReducedMotion(matches: boolean): void {
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  } as unknown as MediaQueryList;
  jest.spyOn(globalThis, 'matchMedia').mockReturnValue(mql);
}

describe('InboxScreen', () => {
  describe('landing screen (closed)', () => {
    it('shows only the capture box and a subtle "View inbox" link, no list', () => {
      render(<InboxScreen open={false} />);

      expect(screen.getByTestId('capture-box')).toBeInTheDocument();

      const viewLink = screen.getByRole('link', { name: /view inbox/i });
      expect(viewLink).toHaveAttribute('href', '/?view=inbox');

      // The inbox list is not revealed on the bare landing screen.
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
      expect(screen.queryByTestId('inbox-reveal')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /close inbox/i })).not.toBeInTheDocument();
    });
  });

  describe('inbox screen (open)', () => {
    it('reveals the inbox list (faded in) and a Close link', () => {
      render(<InboxScreen open />);

      expect(screen.getByTestId('capture-box')).toBeInTheDocument();
      expect(screen.getByTestId('task-list')).toBeInTheDocument();

      const reveal = screen.getByTestId('inbox-reveal');
      expect(reveal).toHaveClass('animate-fade-in');
      expect(reveal).toHaveAttribute('aria-hidden', 'false');

      const closeLink = screen.getByRole('link', { name: /close inbox/i });
      expect(closeLink).toHaveAttribute('href', '/');

      expect(screen.queryByRole('link', { name: /view inbox/i })).not.toBeInTheDocument();
    });
  });

  describe('toggling between landing and inbox', () => {
    it('reveals the list with a fade-in when toggled open', () => {
      const { rerender } = render(<InboxScreen open={false} />);
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

      rerender(<InboxScreen open />);

      expect(screen.getByTestId('task-list')).toBeInTheDocument();
      expect(screen.getByTestId('inbox-reveal')).toHaveClass('animate-fade-in');
      // The View-inbox affordance is swapped for the Close affordance.
      expect(screen.getByRole('link', { name: /close inbox/i })).toBeInTheDocument();
    });

    it('keeps the list mounted (fading out) when toggled closed, then unmounts on animation end', () => {
      mockReducedMotion(false); // motion allowed → real fade-out

      const { rerender } = render(<InboxScreen open />);
      expect(screen.getByTestId('task-list')).toBeInTheDocument();

      rerender(<InboxScreen open={false} />);

      // Still mounted so the exit animation can play, now in its fade-out state.
      const reveal = screen.getByTestId('inbox-reveal');
      expect(reveal).toHaveClass('animate-fade-out');
      expect(reveal).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
      // The landing affordance is already back.
      expect(screen.getByRole('link', { name: /view inbox/i })).toBeInTheDocument();

      // When the fade-out animation finishes, the list unmounts.
      fireEvent.animationEnd(reveal);
      expect(screen.queryByTestId('inbox-reveal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    });

    it('ignores animationEnd bubbling up from a child so the panel is not collapsed early', () => {
      mockReducedMotion(false);

      const { rerender } = render(<InboxScreen open />);
      rerender(<InboxScreen open={false} />);
      expect(screen.getByTestId('task-list')).toBeInTheDocument();

      // A descendant's animation ending must NOT unmount the panel (only the
      // container's own fade-out should). The eyebrow label lives inside the panel.
      fireEvent.animationEnd(screen.getByText('Inbox'));

      expect(screen.getByTestId('inbox-reveal')).toBeInTheDocument();
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });

    it('unmounts the list immediately on close when reduced motion is preferred', () => {
      mockReducedMotion(true); // no fade-out animation will run

      const { rerender } = render(<InboxScreen open />);
      expect(screen.getByTestId('task-list')).toBeInTheDocument();

      rerender(<InboxScreen open={false} />);

      // No animationEnd is fired, yet the list is gone right away.
      expect(screen.queryByTestId('inbox-reveal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    });
  });

  describe('reduced-motion subscription wiring', () => {
    it('subscribes to matchMedia using the prefers-reduced-motion query string', () => {
      // Verify the exact media query string used — killing the REDUCED_MOTION_QUERY mutation.
      const spy = jest.spyOn(globalThis, 'matchMedia');
      render(<InboxScreen open={false} />);

      // useSyncExternalStore calls subscribe immediately and the snapshot getter.
      // Both should use the correct query string.
      expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    });

    it('adds a change event listener to the matchMedia query on mount', () => {
      const addEventListenerMock = jest.fn();
      const removeEventListenerMock = jest.fn();
      const mql = {
        matches: false,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
        dispatchEvent: jest.fn(),
      } as unknown as MediaQueryList;
      jest.spyOn(globalThis, 'matchMedia').mockReturnValue(mql);

      render(<InboxScreen open={false} />);

      // The subscribe function must wire up a 'change' listener (not '').
      expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('removes the change event listener on unmount (cleanup)', () => {
      const addEventListenerMock = jest.fn();
      const removeEventListenerMock = jest.fn();
      const mql = {
        matches: false,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
        dispatchEvent: jest.fn(),
      } as unknown as MediaQueryList;
      jest.spyOn(globalThis, 'matchMedia').mockReturnValue(mql);

      const { unmount } = render(<InboxScreen open={false} />);
      unmount();

      // The cleanup must remove the 'change' listener (not '').
      expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('TaskList prop wiring', () => {
    it('passes the inbox scope to TaskList', () => {
      render(<InboxScreen open />);

      // Verify scope={{ type: 'inbox' }} is passed — kills the ObjectLiteral and StringLiteral mutants.
      expect(lastTaskListScope).toEqual({ type: 'inbox' });
    });

    it('passes the empty message to TaskList', () => {
      render(<InboxScreen open />);

      expect(screen.getByTestId('task-list')).toHaveTextContent('Your inbox is empty');
    });
  });
});
