import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { Toast } from '@/lib/stores/toast-store';

import { ToastViewport } from './toast-viewport';

// Control the rendered queue + capture dismissals by mocking the store hooks directly.
const mockDismissToast = jest.fn();
let mockQueue: Toast[] = [];
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToasts: () => mockQueue,
  useToastActions: () => ({ showToast: jest.fn(), dismissToast: mockDismissToast }),
}));

function makeToast(overrides: Partial<Toast> = {}): Toast {
  return {
    id: 't1',
    message: 'ALF-42 moved to Ready for Dev',
    variant: 'default',
    leaving: false,
    ...overrides,
  };
}

function cardFor(message: string): HTMLElement {
  const card = screen.getByText(message).closest('[data-variant]');
  if (!(card instanceof HTMLElement)) throw new Error('toast card not found');
  return card;
}

describe('ToastViewport', () => {
  afterEach(() => {
    mockQueue = [];
    mockDismissToast.mockClear();
  });

  it('renders the glow + bigger-size classes for an emphasis toast', () => {
    mockQueue = [makeToast({ variant: 'emphasis' })];
    render(<ToastViewport />);

    const card = cardFor('ALF-42 moved to Ready for Dev');
    expect(card).toHaveClass('glow-emphasis', 'border-accent-teal', 'px-5', 'py-4', 'text-base');
  });

  it('does not render the emphasis classes for a default toast', () => {
    mockQueue = [makeToast({ variant: 'default' })];
    render(<ToastViewport />);

    const card = cardFor('ALF-42 moved to Ready for Dev');
    expect(card).not.toHaveClass('glow-emphasis');
    expect(card).toHaveClass('border-border', 'px-4', 'py-3', 'text-sm');
  });

  it('renders the enter classes for a visible toast and exit classes for a leaving one', () => {
    mockQueue = [
      makeToast({ id: 'a', message: 'visible toast', leaving: false }),
      makeToast({ id: 'b', message: 'leaving toast', leaving: true }),
    ];
    render(<ToastViewport />);

    expect(cardFor('visible toast')).toHaveClass('animate-in', 'slide-in-from-bottom-2');
    expect(cardFor('leaving toast')).toHaveClass(
      'animate-out',
      'slide-out-to-bottom-2',
      // Holds the toast hidden after the 200ms exit until EXIT_MS removal — no revert flash.
      'fill-mode-forwards',
    );
  });

  it('dismisses a toast when its close button is clicked', async () => {
    const user = userEvent.setup();
    mockQueue = [makeToast({ id: 'x' })];
    render(<ToastViewport />);

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(mockDismissToast).toHaveBeenCalledWith('x');
  });
});
