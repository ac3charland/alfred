import { act, render, screen } from '@testing-library/react';
import * as React from 'react';

import { useClassifiedFlash } from '@/lib/hooks/use-classified-flash';
import type { ClassificationOrigin } from '@/lib/tasks/classification';

function Probe({ origin }: { origin: ClassificationOrigin | null }) {
  const flashing = useClassifiedFlash(origin);
  return <div data-testid="probe" data-flashing={flashing} />;
}

/**
 * The probe's flag, read as an attribute rather than through `dataset`: the `noPropertyAccessFromIndexSignature`
 * tsconfig rejects `dataset.flashing`, and reaching for `getAttribute` instead only invites
 * `unicorn/prefer-dom-node-dataset` to rewrite it back. `toHaveAttribute` sidesteps both.
 */
function probe() {
  return screen.getByTestId('probe');
}

describe('useClassifiedFlash', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flashes when a verdict lands on a row that was unjudged, then fades', () => {
    const { rerender } = render(<Probe origin="unjudged" />);
    expect(probe()).toHaveAttribute('data-flashing', 'false');

    rerender(<Probe origin="model" />);
    expect(probe()).toHaveAttribute('data-flashing', 'true');

    act(() => {
      jest.runAllTimers();
    });
    expect(probe()).toHaveAttribute('data-flashing', 'false');
  });

  it('does not flash a row that mounts already classified', () => {
    // A reload seeds hundreds of judged rows. Only a verdict ARRIVING is news; one that was
    // already there when the row mounted is just the row.
    render(<Probe origin="model" />);
    expect(probe()).toHaveAttribute('data-flashing', 'false');
  });

  it('does not flash when the owner claims the row themselves', () => {
    // Their own edit stamped it. They know — they just did it.
    const { rerender } = render(<Probe origin="unjudged" />);
    rerender(<Probe origin="claimed" />);
    expect(probe()).toHaveAttribute('data-flashing', 'false');
  });

  it('never flashes a row that asks no provenance question', () => {
    // A subtask, a dispatched row, the Completed view: the mark is absent there, so there is
    // nothing for a ring to be about.
    const { rerender } = render(<Probe origin={null} />);
    rerender(<Probe origin="model" />);
    expect(probe()).toHaveAttribute('data-flashing', 'false');
  });

  it('does not re-flash when an already-flashed row re-renders', () => {
    const { rerender } = render(<Probe origin="unjudged" />);
    rerender(<Probe origin="model" />);
    act(() => {
      jest.runAllTimers();
    });
    expect(probe()).toHaveAttribute('data-flashing', 'false');

    rerender(<Probe origin="model" />);
    expect(probe()).toHaveAttribute('data-flashing', 'false');
  });
});
