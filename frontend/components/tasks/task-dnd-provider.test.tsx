import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';

import { TaskDndProvider } from './task-dnd-provider';

describe('TaskDndProvider', () => {
  it('renders its children inside the drag-and-drop context', () => {
    renderWithProviders(
      <TaskDndProvider>
        <p>module content</p>
      </TaskDndProvider>,
    );

    expect(screen.getByText('module content')).toBeInTheDocument();
  });
});
