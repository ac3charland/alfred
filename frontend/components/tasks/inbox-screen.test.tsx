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

// The collapse-all button reads the shared stores; stub it here like the other
// store-reading children, since these tests render InboxScreen without providers.
jest.mock('./collapse-all-button', () => ({
  CollapseAllButton: function MockCollapseAllButton() {
    return <button type="button" aria-label="Collapse all" />;
  },
}));

// The Select toggle + bulk bar read the inbox-selection store; stub them like the other
// store-reading children (these tests render InboxScreen without providers).
jest.mock('./inbox-bulk-bar', () => ({
  InboxSelectToggle: function MockInboxSelectToggle() {
    return <button type="button">Select</button>;
  },
  InboxBulkBar: function MockInboxBulkBar() {
    return <div data-testid="inbox-bulk-bar" />;
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

  describe('vertical centering (landing vs inbox)', () => {
    it('top and bottom spacers have grow class when closed (capture box centered)', () => {
      render(<InboxScreen open={false} />);

      expect(screen.getByTestId('center-spacer-top')).toHaveClass('grow');
      expect(screen.getByTestId('center-spacer-bottom')).toHaveClass('grow');
    });

    it('spacers have grow-0 class when open (capture box at top)', () => {
      render(<InboxScreen open />);

      expect(screen.getByTestId('center-spacer-top')).toHaveClass('grow-0');
      expect(screen.getByTestId('center-spacer-bottom')).toHaveClass('grow-0');
    });
  });

  describe('inbox screen (open)', () => {
    it('reveals the inbox list (expanded) and a Close link', () => {
      render(<InboxScreen open />);

      expect(screen.getByTestId('capture-box')).toBeInTheDocument();
      expect(screen.getByTestId('task-list')).toBeInTheDocument();

      const reveal = screen.getByTestId('inbox-reveal');
      expect(reveal).not.toHaveClass('animate-expand-y');
      expect(reveal).toHaveAttribute('aria-hidden', 'false');

      const closeLink = screen.getByRole('link', { name: /close inbox/i });
      expect(closeLink).toHaveAttribute('href', '/');

      expect(screen.queryByRole('link', { name: /view inbox/i })).not.toBeInTheDocument();
    });

    it('shows the inbox immediately with no expand animation on direct navigation', () => {
      // Mounting with open=true (e.g. navigating from a folder or loading /?view=inbox
      // directly) must not play the expand animation — the list is already "there".
      render(<InboxScreen open />);

      const reveal = screen.getByTestId('inbox-reveal');
      expect(reveal).not.toHaveClass('animate-expand-y');
      expect(reveal).not.toHaveClass('animate-collapse-y');
    });
  });

  describe('toggling between landing and inbox', () => {
    it('reveals the list with an expand animation when toggled open', () => {
      const { rerender } = render(<InboxScreen open={false} />);
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

      rerender(<InboxScreen open />);

      expect(screen.getByTestId('task-list')).toBeInTheDocument();
      expect(screen.getByTestId('inbox-reveal')).toHaveClass('animate-expand-y');
      // The View-inbox affordance is swapped for the Close affordance.
      expect(screen.getByRole('link', { name: /close inbox/i })).toBeInTheDocument();
    });

    it('keeps the list mounted (collapsing) when toggled closed, then unmounts on animation end', () => {
      mockReducedMotion(false); // motion allowed → real collapse animation

      const { rerender } = render(<InboxScreen open />);
      expect(screen.getByTestId('task-list')).toBeInTheDocument();

      rerender(<InboxScreen open={false} />);

      // Still mounted so the exit animation can play, now in its collapse state.
      const reveal = screen.getByTestId('inbox-reveal');
      expect(reveal).toHaveClass('animate-collapse-y');
      expect(reveal).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
      // The landing affordance is already back.
      expect(screen.getByRole('link', { name: /view inbox/i })).toBeInTheDocument();

      // When the collapse animation finishes, the list unmounts.
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
      // container's own collapse should). The eyebrow label lives inside the panel.
      fireEvent.animationEnd(screen.getByText('Inbox'));

      expect(screen.getByTestId('inbox-reveal')).toBeInTheDocument();
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });

    it('unmounts the list immediately on close when reduced motion is preferred', () => {
      mockReducedMotion(true); // no collapse animation will run

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
