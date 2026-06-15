import { render, screen } from '@testing-library/react';
import * as React from 'react';

import type { ItemType } from '@/lib/types';

import { TypeBadge } from './type-badge';

describe('TypeBadge', () => {
  it('renders "Task" for a task item', () => {
    render(<TypeBadge itemType="task" />);

    expect(screen.getByText('Task')).toBeInTheDocument();
  });

  it('renders "Code" for a code item', () => {
    render(<TypeBadge itemType="code" />);

    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('renders nothing for an unclassified item (no badge until classified)', () => {
    const { container } = render(<TypeBadge itemType="unclassified" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a knowledge item (reserved, not built)', () => {
    // `knowledge` is a valid enum member reserved for a future type; the badge leaves
    // room for it but renders nothing today.
    const knowledge = 'knowledge' as ItemType;
    const { container } = render(<TypeBadge itemType={knowledge} />);

    expect(container).toBeEmptyDOMElement();
  });
});
