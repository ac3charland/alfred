import { render, screen } from '@testing-library/react';
import * as React from 'react';

import type { ItemType } from '@/lib/types';

import { TypeGlyph } from './type-glyph';

describe('TypeGlyph', () => {
  it('renders an accessible "Code" icon for a code item', () => {
    render(<TypeGlyph itemType="code" />);

    expect(screen.getByRole('img', { name: 'Code' })).toBeInTheDocument();
  });

  it('renders an accessible "Task" icon for a task item', () => {
    render(<TypeGlyph itemType="task" />);

    expect(screen.getByRole('img', { name: 'Task' })).toBeInTheDocument();
  });

  it('renders nothing for an unclassified item', () => {
    const { container } = render(<TypeGlyph itemType="unclassified" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a knowledge item (reserved, not built)', () => {
    const knowledge = 'knowledge' as ItemType;
    const { container } = render(<TypeGlyph itemType={knowledge} />);

    expect(container).toBeEmptyDOMElement();
  });
});
