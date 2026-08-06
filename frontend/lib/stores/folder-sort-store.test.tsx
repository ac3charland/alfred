import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { FolderSortProvider, useFolderSort, useFolderSorts } from './folder-sort-store';

describe('FolderSortProvider', () => {
  it('throws when read outside a provider', () => {
    expect(() => renderHook(() => useFolderSorts())).toThrow(
      /must be used within a FolderSortProvider/,
    );
  });

  it('starts empty, so every folder falls through to the default mode', () => {
    const { result } = renderHook(() => useFolderSorts(), { wrapper: FolderSortProvider });

    expect(result.current.byFolderId.size).toBe(0);
  });
});

describe('useFolderSort', () => {
  function Consumer({ folderId }: { folderId: string }) {
    const { mode, setMode } = useFolderSort(folderId);
    return (
      <div>
        <span data-testid={`mode-${folderId}`}>{mode}</span>
        <button
          type="button"
          onClick={() => {
            setMode('due');
          }}
        >
          sort {folderId} by due
        </button>
      </div>
    );
  }

  it('reports the default mode for a folder nobody has sorted', () => {
    render(
      <FolderSortProvider>
        <Consumer folderId="work" />
      </FolderSortProvider>,
    );

    expect(screen.getByTestId('mode-work')).toHaveTextContent('priority');
  });

  it('keeps each folder on its own mode', async () => {
    const user = userEvent.setup();
    render(
      <FolderSortProvider>
        <Consumer folderId="work" />
        <Consumer folderId="home" />
      </FolderSortProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'sort work by due' }));

    expect(screen.getByTestId('mode-work')).toHaveTextContent('due');
    expect(screen.getByTestId('mode-home')).toHaveTextContent('priority');
  });
});

/**
 * The reason the choice lives in a provider rather than the view's own state: the folder view is
 * unmounted and remounted every time `TaskViews` re-derives the view from the URL, so a mode held
 * locally would snap back to the default the moment you visited another folder and returned.
 */
describe('the sort choice across a view remount', () => {
  function Harness() {
    const [folderId, setFolderId] = React.useState('work');
    return (
      <FolderSortProvider>
        <button
          type="button"
          onClick={() => {
            setFolderId((current) => (current === 'work' ? 'home' : 'work'));
          }}
        >
          switch folder
        </button>
        <Consumer key={folderId} folderId={folderId} />
      </FolderSortProvider>
    );
  }

  function Consumer({ folderId }: { folderId: string }) {
    const { mode, setMode } = useFolderSort(folderId);
    return (
      <div>
        <span data-testid="mode">{mode}</span>
        <button
          type="button"
          onClick={() => {
            setMode('due');
          }}
        >
          sort by due
        </button>
      </div>
    );
  }

  it('survives leaving the folder and coming back', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'sort by due' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('due');

    // Away to another folder — which is at its own default — and back.
    await user.click(screen.getByRole('button', { name: 'switch folder' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('priority');

    await user.click(screen.getByRole('button', { name: 'switch folder' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('due');
  });
});
