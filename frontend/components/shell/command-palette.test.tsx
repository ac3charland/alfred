import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { CommandPalette } from '@/components/shell/command-palette';
import { CodeProvider } from '@/lib/stores/code-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { Folder, Project } from '@/lib/types';

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return { id: 'f1', name: 'A folder', created_at: '2025-01-01T00:00:00Z', ...overrides };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'A project',
    key: 'PRJ',
    created_at: '2025-01-01T00:00:00Z',
    github_url: null,
    ref_seq: 0,
    repo_name: 'repo',
    repo_owner: 'owner',
    ...overrides,
  };
}

function renderPalette(seed: { folders?: Folder[]; projects?: Project[] } = {}) {
  return render(
    <ToastProvider>
      <FoldersProvider initialFolders={seed.folders ?? []}>
        <CodeProvider initialProjects={seed.projects ?? []} initialEpics={[]} initialStories={[]}>
          <CommandPalette />
        </CodeProvider>
      </FoldersProvider>
    </ToastProvider>,
  );
}

/** Dispatch the global ⌘K chord the shortcut hook listens for; returns the (cancelled?) event. */
function pressCmdK(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    globalThis.dispatchEvent(event);
  });
  return event;
}

describe('CommandPalette', () => {
  it('opens on ⌘K, claims the keypress, and shows all destinations grouped with the input focused', async () => {
    renderPalette({
      folders: [makeFolder({ id: 'fa', name: 'Software' })],
      projects: [makeProject({ id: 'pa', name: 'Alfred', key: 'ALF' })],
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const event = pressCmdK();
    expect(event.defaultPrevented).toBe(true);

    const input = await screen.findByRole('combobox', { name: /go to a place/i });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');

    const listbox = screen.getByRole('listbox');
    // Static go-to destinations + the seeded folder and project.
    for (const label of [
      'Tasks',
      'Inbox',
      'Priority',
      'Completed',
      'Code',
      'Backlog',
      'Needs human action',
    ]) {
      expect(within(listbox).getByText(label)).toBeInTheDocument();
    }
    expect(within(listbox).getByText('Software')).toBeInTheDocument();
    expect(within(listbox).getByText('Alfred')).toBeInTheDocument();
    expect(within(listbox).getByText('ALF')).toBeInTheDocument();
  });

  it('toggles closed when ⌘K is pressed again while open', async () => {
    renderPalette();
    pressCmdK();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    pressCmdK();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters case-insensitively across groups as you type', async () => {
    const user = userEvent.setup();
    renderPalette({
      folders: [makeFolder({ id: 'fa', name: 'Software' }), makeFolder({ id: 'fb', name: 'Home' })],
      projects: [makeProject({ id: 'pa', name: 'Software Factory', key: 'SFT' })],
    });
    pressCmdK();
    await user.keyboard('SOFT');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Software')).toBeInTheDocument();
    expect(within(listbox).getByText('Software Factory')).toBeInTheDocument();
    expect(within(listbox).queryByText('Home')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Tasks')).not.toBeInTheDocument();
  });

  it('matches a project by its key', async () => {
    const user = userEvent.setup();
    renderPalette({ projects: [makeProject({ id: 'pa', name: 'Alfred', key: 'ALF' })] });
    pressCmdK();
    await user.keyboard('alf');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Alfred')).toBeInTheDocument();
  });

  it('moves the active row with ArrowDown via aria-activedescendant and navigates on Enter', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    renderPalette({ projects: [makeProject({ id: 'pa', name: 'Alfred', key: 'ALF' })] });

    pressCmdK();
    const input = screen.getByRole('combobox', { name: /go to a place/i });
    // First flattened destination is Tasks (/).
    expect(input).toHaveAttribute('aria-activedescendant', 'command-destination-go-tasks');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'command-destination-go-inbox');

    await user.keyboard('{Enter}');
    expect(pushState).toHaveBeenCalledWith(null, '', '/?view=inbox');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigates to a hovered-then-selected project destination', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    renderPalette({ projects: [makeProject({ id: 'pa', name: 'Alfred', key: 'ALF' })] });

    pressCmdK();
    await user.keyboard('alfred');
    await user.click(screen.getByRole('option', { name: /alfred/i }));

    expect(pushState).toHaveBeenCalledWith(null, '', '/code/pa');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape without navigating', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    renderPalette();

    pressCmdK();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pushState).not.toHaveBeenCalled();
  });
});
