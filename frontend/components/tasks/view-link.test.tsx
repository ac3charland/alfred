import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { ViewLink } from './view-link';

describe('ViewLink', () => {
  let pushState: jest.SpyInstance;

  beforeEach(() => {
    // Stub pushState so the test never actually mutates jsdom history, and assert on it.
    pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
  });

  afterEach(() => {
    pushState.mockRestore();
  });

  it('renders a real anchor with the href and children', () => {
    render(<ViewLink href="/folders/f1">Work</ViewLink>);

    const link = screen.getByRole('link', { name: 'Work' });
    expect(link).toHaveAttribute('href', '/folders/f1');
  });

  it('forwards extra anchor props (className, aria-label)', () => {
    render(
      <ViewLink href="/completed" className="nav" aria-label="Completed">
        Completed
      </ViewLink>,
    );

    const link = screen.getByRole('link', { name: 'Completed' });
    expect(link).toHaveClass('nav');
  });

  it('intercepts a plain primary click: prevents default and pushes the href', () => {
    render(<ViewLink href="/folders/f1">Work</ViewLink>);

    // fireEvent.click returns false when a handler called preventDefault.
    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Work' }), {
      button: 0,
    });

    expect(notCancelled).toBe(false);
    expect(pushState).toHaveBeenCalledWith(null, '', '/folders/f1');
  });

  it('does NOT intercept a modified click (lets the browser open a new tab)', () => {
    render(<ViewLink href="/folders/f1">Work</ViewLink>);

    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Work' }), {
      button: 0,
      metaKey: true,
    });

    expect(notCancelled).toBe(true);
    expect(pushState).not.toHaveBeenCalled();
  });

  it('does NOT intercept a non-primary (middle) click', () => {
    render(<ViewLink href="/folders/f1">Work</ViewLink>);

    fireEvent.click(screen.getByRole('link', { name: 'Work' }), { button: 1 });

    expect(pushState).not.toHaveBeenCalled();
  });

  it('calls a provided onClick before switching the view', () => {
    const onClick = jest.fn();
    render(
      <ViewLink href="/" onClick={onClick}>
        Home
      </ViewLink>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Home' }), { button: 0 });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledWith(null, '', '/');
  });

  it('honors an onClick that prevents default (no view switch)', () => {
    const onClick = jest.fn((event_: React.MouseEvent) => {
      event_.preventDefault();
    });
    render(
      <ViewLink href="/" onClick={onClick}>
        Home
      </ViewLink>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Home' }), { button: 0 });

    expect(onClick).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });
});
