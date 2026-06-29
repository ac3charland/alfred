import { fireEvent, render, screen } from '@testing-library/react';

import { AnimatedHeightReveal } from './animated-height-reveal';

describe('AnimatedHeightReveal', () => {
  it('renders its children', () => {
    render(
      <AnimatedHeightReveal open onExited={jest.fn()}>
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    expect(screen.getByText('field')).toBeInTheDocument();
  });

  it('grows the height in and fades the content in when open', () => {
    render(
      <AnimatedHeightReveal open onExited={jest.fn()}>
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    const wrapper = screen.getByTestId('animated-height-reveal');
    expect(wrapper).toHaveClass('grid', 'animate-expand-y');
    expect(wrapper).not.toHaveClass('animate-collapse-y');
    // Reduced-motion users get no entrance (SPEC §5.4).
    expect(wrapper).toHaveClass('motion-reduce:animate-none');

    const content = screen.getByText('field').parentElement;
    expect(content).toHaveClass('animate-fade-in', 'motion-reduce:animate-none');
  });

  it('collapses the height out and fades the content out when closing', () => {
    render(
      <AnimatedHeightReveal open={false} onExited={jest.fn()}>
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    const wrapper = screen.getByTestId('animated-height-reveal');
    expect(wrapper).toHaveClass('grid', 'animate-collapse-y');
    expect(wrapper).not.toHaveClass('animate-expand-y');

    const content = screen.getByText('field').parentElement;
    expect(content).toHaveClass('animate-fade-out', 'motion-reduce:animate-none');
  });

  it('hides the region from the accessibility tree while closing', () => {
    render(
      <AnimatedHeightReveal open={false} onExited={jest.fn()}>
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    expect(screen.getByTestId('animated-height-reveal')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is not aria-hidden when open', () => {
    render(
      <AnimatedHeightReveal open onExited={jest.fn()}>
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    expect(screen.getByTestId('animated-height-reveal')).toHaveAttribute('aria-hidden', 'false');
  });

  it('calls onExited only when its own collapse animation ends', () => {
    const onExited = jest.fn();
    render(
      <AnimatedHeightReveal open={false} onExited={onExited}>
        <button type="button">child</button>
      </AnimatedHeightReveal>,
    );
    const wrapper = screen.getByTestId('animated-height-reveal');

    // The collapse animation finishing on the wrapper itself drives the unmount.
    fireEvent.animationEnd(wrapper);
    expect(onExited).toHaveBeenCalledTimes(1);

    // A child's animation (the fade) bubbles up but must NOT trigger the unmount. The button is
    // inside the aria-hidden closing region, so reach it by text rather than role.
    fireEvent.animationEnd(screen.getByText('child'));
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('does not call onExited when the entrance animation ends', () => {
    const onExited = jest.fn();
    render(
      <AnimatedHeightReveal open onExited={onExited}>
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    // The expand-y entrance finishing must not be mistaken for the exit.
    fireEvent.animationEnd(screen.getByTestId('animated-height-reveal'));
    expect(onExited).not.toHaveBeenCalled();
  });

  it('applies className to the fading content layer', () => {
    render(
      <AnimatedHeightReveal open onExited={jest.fn()} className="px-2">
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    expect(screen.getByText('field').parentElement).toHaveClass('px-2');
  });

  it('applies a custom testId to the outer wrapper', () => {
    render(
      <AnimatedHeightReveal open onExited={jest.fn()} testId="field-reveal">
        <span>field</span>
      </AnimatedHeightReveal>,
    );
    expect(screen.getByTestId('field-reveal')).toBeInTheDocument();
  });
});
