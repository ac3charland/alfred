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

  it('renders Tasks and Code segments as links', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
  });

  it('points Tasks at / and Code at /code', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('href', '/code');
  });

  it('marks Tasks active on the inbox/landing route', () => {
    mockPathname.mockReturnValue('/');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Code' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Tasks active on a folder and the completed route', () => {
    mockPathname.mockReturnValue('/folders/f1');
    const { rerender } = render(<ViewSwitcher />);
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

  it('applies the active accent class to the active segment', () => {
    mockPathname.mockReturnValue('/code');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Code' })).toHaveClass('text-accent-teal');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveClass('text-accent-teal');
  });

  it('calls onNavigate when a segment is clicked', () => {
    const onNavigate = jest.fn();
    render(<ViewSwitcher onNavigate={onNavigate} />);

    screen.getByRole('link', { name: 'Code' }).click();

    expect(onNavigate).toHaveBeenCalledTimes(1);
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
