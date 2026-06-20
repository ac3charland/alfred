import { fireEvent, render, screen } from '@testing-library/react';

import { AnimatedHeightCollapse } from './animated-height-collapse';

describe('AnimatedHeightCollapse', () => {
  it('renders its children', () => {
    render(
      <AnimatedHeightCollapse open>
        <span>panel body</span>
      </AnimatedHeightCollapse>,
    );
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('uses grid-rows-[1fr] when open', () => {
    render(
      <AnimatedHeightCollapse open>
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    const wrapper = screen.getByTestId('animated-height-collapse');
    expect(wrapper).toHaveClass('grid-rows-[1fr]');
    expect(wrapper).not.toHaveClass('grid-rows-[0fr]');
  });

  it('uses grid-rows-[0fr] when closed', () => {
    render(
      <AnimatedHeightCollapse open={false}>
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    const wrapper = screen.getByTestId('animated-height-collapse');
    expect(wrapper).toHaveClass('grid-rows-[0fr]');
    expect(wrapper).not.toHaveClass('grid-rows-[1fr]');
  });

  it('applies className to the inner overflow-hidden wrapper', () => {
    render(
      <AnimatedHeightCollapse open className="my-list">
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    const inner = screen.getByText('body').parentElement;
    expect(inner).toHaveClass('overflow-hidden', 'my-list');
  });

  it('marks the wrapper aria-hidden + inert when closed (default)', () => {
    render(
      <AnimatedHeightCollapse open={false}>
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    const wrapper = screen.getByTestId('animated-height-collapse');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toHaveAttribute('inert');
  });

  it('is not aria-hidden when open', () => {
    render(
      <AnimatedHeightCollapse open>
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    const wrapper = screen.getByTestId('animated-height-collapse');
    expect(wrapper).toHaveAttribute('aria-hidden', 'false');
    expect(wrapper).not.toHaveAttribute('inert');
  });

  it('keeps closed content reachable when hideWhenClosed is false', () => {
    render(
      <AnimatedHeightCollapse open={false} hideWhenClosed={false}>
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    const wrapper = screen.getByTestId('animated-height-collapse');
    expect(wrapper).toHaveAttribute('aria-hidden', 'false');
    expect(wrapper).not.toHaveAttribute('inert');
  });

  it('applies a custom testId to the outer wrapper', () => {
    render(
      <AnimatedHeightCollapse open testId="my-collapse">
        <span>body</span>
      </AnimatedHeightCollapse>,
    );
    expect(screen.getByTestId('my-collapse')).toBeInTheDocument();
  });

  it('fires onTransitionEnd only for its own grid-template-rows transition', () => {
    const onTransitionEnd = jest.fn();
    render(
      <AnimatedHeightCollapse open onTransitionEnd={onTransitionEnd}>
        <button type="button">child</button>
      </AnimatedHeightCollapse>,
    );
    const wrapper = screen.getByTestId('animated-height-collapse');

    // jsdom drops `propertyName` from fireEvent.transitionEnd, so build the event by hand.
    const ownEvent = new Event('transitionend', { bubbles: true });
    Object.defineProperty(ownEvent, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(wrapper, ownEvent);
    expect(onTransitionEnd).toHaveBeenCalledTimes(1);

    // A different property on the wrapper must not fire.
    const otherProp = new Event('transitionend', { bubbles: true });
    Object.defineProperty(otherProp, 'propertyName', { value: 'opacity' });
    fireEvent(wrapper, otherProp);
    expect(onTransitionEnd).toHaveBeenCalledTimes(1);

    // A grid-template-rows transition bubbling from a child must not fire.
    const child = screen.getByRole('button', { name: 'child' });
    const childEvent = new Event('transitionend', { bubbles: true });
    Object.defineProperty(childEvent, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(child, childEvent);
    expect(onTransitionEnd).toHaveBeenCalledTimes(1);
  });
});
