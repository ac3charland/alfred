import { render, screen } from '@testing-library/react';

import { AnimatedHeightEnter } from './animated-height-enter';

describe('AnimatedHeightEnter', () => {
  it('renders its children when entering', () => {
    render(
      <AnimatedHeightEnter entering>
        <span>new row</span>
      </AnimatedHeightEnter>,
    );
    expect(screen.getByText('new row')).toBeInTheDocument();
  });

  it('wraps the content in the height-expand keyframe when entering', () => {
    render(
      <AnimatedHeightEnter entering>
        <span>body</span>
      </AnimatedHeightEnter>,
    );
    const wrapper = screen.getByTestId('animated-height-enter');
    expect(wrapper).toHaveClass('grid', 'animate-expand-y');
    // Reduced-motion users get no entrance (SPEC §5.4).
    expect(wrapper).toHaveClass('motion-reduce:animate-none');
  });

  it('fades and slides the content in from above when entering', () => {
    render(
      <AnimatedHeightEnter entering>
        <span>body</span>
      </AnimatedHeightEnter>,
    );
    // The content sits inside the overflow-hidden clip, under the fade/slide layer.
    const content = screen.getByText('body').parentElement;
    expect(content).toHaveClass('animate-in', 'fade-in-0', 'slide-in-from-top-2');
    expect(content).toHaveClass('motion-reduce:animate-none');
  });

  it('renders children unwrapped when not entering', () => {
    render(
      <AnimatedHeightEnter entering={false}>
        <span>existing row</span>
      </AnimatedHeightEnter>,
    );
    expect(screen.getByText('existing row')).toBeInTheDocument();
    // No entrance wrapper at all for a settled row — no extra DOM, no animation.
    expect(screen.queryByTestId('animated-height-enter')).not.toBeInTheDocument();
  });

  it('applies a custom testId to the outer wrapper', () => {
    render(
      <AnimatedHeightEnter entering testId="row-enter">
        <span>body</span>
      </AnimatedHeightEnter>,
    );
    expect(screen.getByTestId('row-enter')).toBeInTheDocument();
  });
});
