import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { ViewSwitcher } from './view-switcher';

// Mock next/navigation so the test controls the active route. The segments are now
// ViewLink anchors (a History-API switch since ALF-27), so a plain click calls
// history.pushState — stub it so jsdom doesn't actually mutate the test URL.
const mockPathname = jest.fn<string, []>(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

describe('ViewSwitcher', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
  });

  it('renders a segment per module as a link', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Comms' })).toBeInTheDocument();
  });

  it('points each segment at its module default view', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/priority');
    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('href', '/code');
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveAttribute('href', '/comms');
  });

  it('marks Tasks active on the inbox/landing route', () => {
    mockPathname.mockReturnValue('/');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Code' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Tasks active on the priority, a folder, and the completed route', () => {
    mockPathname.mockReturnValue('/priority');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

    mockPathname.mockReturnValue('/folders/f1');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

    mockPathname.mockReturnValue('/completed');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Code active on the /code landing route', () => {
    mockPathname.mockReturnValue('/code');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Code active on a project board route', () => {
    mockPathname.mockReturnValue('/code/abc-123');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Comms active on its landing route and on a settings route beneath it', () => {
    mockPathname.mockReturnValue('/comms');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');

    mockPathname.mockReturnValue('/comms/people');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveAttribute('aria-current', 'page');
  });

  it('gives the active segment its OWN module accent, not one shared colour', () => {
    mockPathname.mockReturnValue('/code');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Code' })).toHaveClass('text-accent-teal');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveClass('text-accent-teal');

    // Comms is the blue module, so its active segment must not borrow the app's teal.
    mockPathname.mockReturnValue('/comms');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveClass('text-accent-blue');
    expect(screen.getByRole('link', { name: 'Comms' })).not.toHaveClass('text-accent-teal');
  });

  it('exposes a labelled group for the switcher', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('group', { name: /switch module/i })).toBeInTheDocument();
  });

  it('hugs its content instead of spanning the full sidebar width', () => {
    render(<ViewSwitcher />);

    const group = screen.getByRole('group', { name: /switch module/i });
    expect(group).toHaveClass('w-fit');
    expect(group).toHaveClass('gap-1');
    expect(group).not.toHaveClass('justify-between');
  });
});
