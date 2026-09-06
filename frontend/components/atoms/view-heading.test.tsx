import { render, screen } from '@testing-library/react';
import { ListOrdered } from 'lucide-react';

import { ViewHeading } from './view-heading';

describe('ViewHeading', () => {
  it('renders the title as a level-2 heading, with the description beside it', () => {
    render(
      <ViewHeading icon={ListOrdered} title="By Priority" description="Ranked by priority." />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'By Priority' })).toBeInTheDocument();
    expect(screen.getByText('Ranked by priority.')).toBeInTheDocument();
  });

  it('renders the supplied glyph, hidden from assistive tech (the title already names the view)', () => {
    const { container } = render(
      <ViewHeading icon={ListOrdered} title="Today" description="Due now." />,
    );

    // lucide renders an <svg>; it carries no accessible name, so it is decorative by default.
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
