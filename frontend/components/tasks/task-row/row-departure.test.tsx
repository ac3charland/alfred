import { render, screen } from '@testing-library/react';

import { RowDeparture } from './row-departure';

/** The wrapper and the clipped child it drives. */
function layers(): { collapse: HTMLElement; content: HTMLElement } {
  const collapse = screen.getByTestId('task-collapse');
  const content = collapse.firstElementChild;
  if (!(content instanceof HTMLElement)) throw new Error('no clipped child');
  return { collapse, content };
}

describe('RowDeparture', () => {
  it('renders the row at rest with no clip, so its focus ring is not shaved', () => {
    render(
      <RowDeparture departing={false}>
        <button type="button">Row</button>
      </RowDeparture>,
    );

    const { collapse, content } = layers();
    expect(collapse).toHaveClass('grid-rows-[1fr]');
    expect(collapse).not.toHaveClass('overflow-hidden');
    expect(content).not.toHaveClass('overflow-hidden');
    expect(content).not.toHaveClass('animate-send-off');
  });

  it('collapses the row and sends it off to the right while departing', () => {
    render(
      <RowDeparture departing>
        <button type="button">Row</button>
      </RowDeparture>,
    );

    const { collapse, content } = layers();
    // The height shrinks to nothing — what pulls the rows below it up into the gap…
    expect(collapse).toHaveClass('grid-rows-[0fr]');
    // …clipped on both layers so the shrink and the rightward slide stay inside the row.
    expect(collapse).toHaveClass('overflow-hidden');
    expect(content).toHaveClass('overflow-hidden');
    // …with the capture box's own slide-out riding on top.
    expect(content).toHaveClass('animate-send-off');
  });
});
