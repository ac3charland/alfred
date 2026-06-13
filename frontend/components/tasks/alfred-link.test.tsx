import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { ALFRED_CAPTURE_FOCUS_EVENT, AlfredLink } from './alfred-link';

const preventingClick = (event_: React.MouseEvent) => {
  event_.preventDefault();
};

describe('AlfredLink', () => {
  let pushState: jest.SpyInstance;

  beforeEach(() => {
    pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
  });

  afterEach(() => {
    pushState.mockRestore();
  });

  it('renders an anchor linking to /', () => {
    render(<AlfredLink>alfred</AlfredLink>);

    expect(screen.getByRole('link', { name: 'alfred' })).toHaveAttribute('href', '/');
  });

  it('forwards extra anchor props (className, aria-label)', () => {
    render(
      <AlfredLink className="brand" aria-label="alfred — back to capture">
        alfred
      </AlfredLink>,
    );

    const link = screen.getByRole('link', { name: 'alfred — back to capture' });
    expect(link).toHaveClass('brand');
  });

  it('dispatches alfred-capture-focus event on a plain primary click', () => {
    const listener = jest.fn();
    globalThis.addEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);

    render(<AlfredLink>alfred</AlfredLink>);
    fireEvent.click(screen.getByRole('link', { name: 'alfred' }), { button: 0 });

    expect(listener).toHaveBeenCalledTimes(1);
    globalThis.removeEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);
  });

  it('navigates to / on a plain primary click', () => {
    render(<AlfredLink>alfred</AlfredLink>);
    fireEvent.click(screen.getByRole('link', { name: 'alfred' }), { button: 0 });

    expect(pushState).toHaveBeenCalledWith(null, '', '/');
  });

  it('does NOT dispatch event for a modified click (metaKey)', () => {
    const listener = jest.fn();
    globalThis.addEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);

    render(<AlfredLink>alfred</AlfredLink>);
    fireEvent.click(screen.getByRole('link', { name: 'alfred' }), { button: 0, metaKey: true });

    expect(listener).not.toHaveBeenCalled();
    globalThis.removeEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);
  });

  it('does NOT dispatch event for a non-primary click', () => {
    const listener = jest.fn();
    globalThis.addEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);

    render(<AlfredLink>alfred</AlfredLink>);
    fireEvent.click(screen.getByRole('link', { name: 'alfred' }), { button: 1 });

    expect(listener).not.toHaveBeenCalled();
    globalThis.removeEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);
  });

  it('does NOT dispatch event when an external onClick prevents default', () => {
    const listener = jest.fn();
    globalThis.addEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);

    render(<AlfredLink onClick={preventingClick}>alfred</AlfredLink>);
    fireEvent.click(screen.getByRole('link', { name: 'alfred' }), { button: 0 });

    expect(listener).not.toHaveBeenCalled();
    globalThis.removeEventListener(ALFRED_CAPTURE_FOCUS_EVENT, listener);
  });
});
