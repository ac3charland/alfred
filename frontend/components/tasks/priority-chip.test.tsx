import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PriorityChip } from './priority-chip';

describe('PriorityChip', () => {
  // ---------------------------------------------------------------------------
  // Compact (task-row badge)
  // ---------------------------------------------------------------------------

  describe('compact (row badge)', () => {
    it('renders the level label as a button, aria-label carrying the value', () => {
      render(<PriorityChip priority="high" />);
      const chip = screen.getByRole('button', { name: 'Priority: High' });
      expect(chip).toHaveAttribute('type', 'button');
      expect(chip).toHaveTextContent('High');
    });

    it('renders each level', () => {
      const { rerender } = render(<PriorityChip priority="medium" />);
      expect(screen.getByText('Medium')).toBeInTheDocument();
      rerender(<PriorityChip priority="low" />);
      expect(screen.getByText('Low')).toBeInTheDocument();
    });

    it('renders symbol-only with no visible label, sizing the glyph to the badge height (ALF-94)', () => {
      const { container } = render(<PriorityChip priority="high" symbolOnly />);
      expect(screen.getByRole('button', { name: 'Priority: High' })).toBeInTheDocument();
      expect(screen.queryByText('High')).not.toBeInTheDocument();
      // The glyph is 16px on every breakpoint now (no md downscale) so the pill matches its
      // Type / Due / count neighbours' height.
      const icon = container.querySelector('svg');
      expect(icon).toHaveClass('h-4', 'w-4');
      expect(icon).not.toHaveClass('md:h-2.5', 'md:w-2.5');
    });

    it('allows overriding the aria-label', () => {
      render(<PriorityChip priority="high" aria-label="Edit priority" />);
      expect(screen.getByRole('button', { name: 'Edit priority' })).toBeInTheDocument();
    });

    it('renders nothing for an unknown level with no empty affordance (missing column → undefined)', () => {
      // Backstop for the production crash: a task_items row can reach the chip with `priority`
      // undefined. With no emptyLabel it must render nothing, not destructure an absent option.
      const { container } = render(<PriorityChip priority={undefined} />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    });

    it('renders the empty affordance when given an emptyLabel (By-Priority "Set priority")', () => {
      render(<PriorityChip priority={null} emptyLabel="Set priority" onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Set priority' })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Comfortable (detail-panel chip) — larger geometry, stable "Priority" name
  // ---------------------------------------------------------------------------

  describe('comfortable (detail chip)', () => {
    it('labels the chip "Priority" and shows the level, tinted by level', () => {
      const { rerender } = render(
        <PriorityChip priority="high" size="comfortable" onChange={jest.fn()} />,
      );
      const chip = screen.getByRole('button', { name: 'Priority' });
      expect(chip).toHaveTextContent('High');
      expect(chip).toHaveClass('rounded-[9px]', 'text-accent-red');

      rerender(<PriorityChip priority="low" size="comfortable" onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Priority' })).toHaveClass('text-accent-blue');
    });

    it('prompts with the emptyLabel and a neutral tone when unset', () => {
      render(
        <PriorityChip
          priority={null}
          size="comfortable"
          emptyLabel="No priority"
          onChange={jest.fn()}
        />,
      );
      const chip = screen.getByRole('button', { name: 'Priority' });
      expect(chip).toHaveTextContent('No priority');
      expect(chip).toHaveClass('text-[#8A96A8]');
    });
  });

  // ---------------------------------------------------------------------------
  // Clickable — opens the shared PriorityMenu, auto-saves the pick
  // ---------------------------------------------------------------------------

  describe('editing (onChange given)', () => {
    it('opens the picker and applies a level (compact)', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(<PriorityChip priority="high" onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Priority: High' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Medium' }));

      expect(onChange).toHaveBeenCalledWith('medium');
    });

    it('clears the level via "No priority" (comfortable)', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(<PriorityChip priority="high" size="comfortable" onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Priority' }));
      await user.click(await screen.findByRole('menuitem', { name: /no priority/i }));

      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  it('is display-only (no picker) when no onChange is given', async () => {
    const user = userEvent.setup();
    render(<PriorityChip priority="high" />);

    await user.click(screen.getByRole('button', { name: 'Priority: High' }));

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('exposes a stable component name for devtools', () => {
    expect(PriorityChip.name).toBe('PriorityChip');
  });
});
