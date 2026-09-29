import { render, screen } from '@testing-library/react';

import { StoryRef } from './story-ref';

describe('StoryRef', () => {
  it('renders its children as a medium-weight monospace label', () => {
    render(<StoryRef color="blue">ALF-42</StoryRef>);

    expect(screen.getByText('ALF-42')).toHaveClass('font-mono', 'font-medium');
  });

  it.each([
    ['blue', 'text-accent-blue'],
    ['amber', 'text-accent-amber'],
    ['green', 'text-accent-green'],
    ['red', 'text-accent-red'],
    ['teal', 'text-accent-teal'],
  ] as const)('tints the label for a %s project', (color, textClass) => {
    render(<StoryRef color={color}>ALF-42</StoryRef>);

    expect(screen.getByText('ALF-42')).toHaveClass(textClass);
  });

  it("adds the caller's size classes without losing the tint", () => {
    render(
      <StoryRef color="amber" className="text-sm">
        ALF-42
      </StoryRef>,
    );

    expect(screen.getByText('ALF-42')).toHaveClass('text-sm', 'text-accent-amber');
  });
});
