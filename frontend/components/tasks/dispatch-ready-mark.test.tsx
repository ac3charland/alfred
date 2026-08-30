import { render, screen } from '@testing-library/react';

import { DispatchReadyMark } from './dispatch-ready-mark';

describe('DispatchReadyMark', () => {
  it('carries the accessible name "Ready to dispatch"', () => {
    render(<DispatchReadyMark />);

    expect(screen.getByRole('img', { name: 'Ready to dispatch' })).toBeInTheDocument();
  });

  it('repeats the accessible name as a native title, so a pointer hover reveals the same words', () => {
    render(<DispatchReadyMark />);

    expect(screen.getByRole('img', { name: 'Ready to dispatch' })).toHaveAttribute(
      'title',
      'Ready to dispatch',
    );
  });

  // The only action this cue could offer is Dispatch itself, which belongs to the bulk bar — so
  // it stays a plain span in every mode, valid even nested inside select mode's single <button>.
  it('is inert — a plain span, not a button, and not focusable', () => {
    render(<DispatchReadyMark />);

    const mark = screen.getByRole('img', { name: 'Ready to dispatch' });
    expect(mark.tagName).toBe('SPAN');
    expect(mark).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
