import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { FolderDropZone } from './folder-drop-zone';

describe('FolderDropZone', () => {
  it('renders its children (the wrapped nav target)', () => {
    render(
      <FolderDropZone id="f1">
        <span>Work</span>
      </FolderDropZone>,
    );

    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('is not marked as an active drop target when nothing is being dragged', () => {
    render(
      <FolderDropZone id="f1">
        <span>Work</span>
      </FolderDropZone>,
    );

    // The data-drop-over marker is set only while a dragged task hovers the zone.
    expect(screen.getByText('Work').parentElement).not.toHaveAttribute('data-drop-over');
  });
});
