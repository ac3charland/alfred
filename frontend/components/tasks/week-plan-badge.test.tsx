import { render, screen } from '@testing-library/react';

import { WeekPlanBadge } from './week-plan-badge';

describe('WeekPlanBadge', () => {
  it('names itself as week-plan provenance', () => {
    render(<WeekPlanBadge />);

    expect(screen.getByText('Week plan')).toBeInTheDocument();
    expect(screen.getByLabelText('Week plan item')).toBeInTheDocument();
  });

  it('is a non-interactive span — the select-mode row is one button', () => {
    render(<WeekPlanBadge />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Week plan item').tagName).toBe('SPAN');
  });
});
