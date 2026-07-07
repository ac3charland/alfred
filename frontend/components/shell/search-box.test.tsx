import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { SearchBox } from '@/components/shell/search-box';
import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';
import { CodeProvider } from '@/lib/stores/code-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { SearchProvider } from '@/lib/stores/search-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeStory, Item } from '@/lib/types';

// The desktop field renders its popover only on a desktop viewport; report a match for the
// `(min-width: 768px)` query so the dropdown mounts under jsdom.
function mockDesktopViewport() {
  jest.spyOn(globalThis, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('min-width'),
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }) as unknown as MediaQueryList,
  );
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    title: 'A task',
    notes: null,
    status: 'active',
    item_type: 'task',
    folder_id: null,
    parent_id: null,
    due_date: null,
    recurrence: null,
    recurrence_series_id: null,
    intended_project_id: null,
    occurrence_index: null,
    source_url: null,
    completed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    user_id: 'u1',
    raw_capture: null,
    ...overrides,
  } as Item;
}

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 's1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 31,
    ref: 'ALF-31',
    factory_state: 'ready_for_dev',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: 'Firewall triage story',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Firewall',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    priority: 1,
    ...overrides,
  };
}

function renderSearchBox(seed: { tasks?: Item[]; stories?: CodeStory[] } = {}) {
  return render(
    <ToastProvider>
      <FoldersProvider initialFolders={[]}>
        <TasksProvider initialTasks={seed.tasks ?? []}>
          <CodeProvider initialProjects={[]} initialEpics={[]} initialStories={seed.stories ?? []}>
            <SearchProvider>
              <SearchBox placement="desktop" />
            </SearchProvider>
          </CodeProvider>
        </TasksProvider>
      </FoldersProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockDesktopViewport();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SearchBox', () => {
  it('focuses the field on ⌘P and claims the keypress from the browser', () => {
    renderSearchBox();
    const input = screen.getByRole('combobox');
    expect(input).not.toHaveFocus();

    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      globalThis.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(input).toHaveFocus();
  });

  it('opens the dropdown and filters across tasks and stories as you type', async () => {
    const user = userEvent.setup();
    renderSearchBox({
      tasks: [
        makeItem({ id: 't1', title: 'Firewall triage UI' }),
        makeItem({ id: 't2', title: 'Buy groceries' }),
      ],
      stories: [makeStory()],
    });

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('firewall');

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('Firewall triage UI')).toBeInTheDocument();
    expect(within(listbox).getByText('Firewall triage story')).toBeInTheDocument();
    expect(within(listbox).queryByText('Buy groceries')).not.toBeInTheDocument();
  });

  it('moves the active option with ArrowDown via aria-activedescendant', async () => {
    const user = userEvent.setup();
    renderSearchBox({
      tasks: [
        makeItem({ id: 't1', title: 'Firewall one' }),
        makeItem({ id: 't2', title: 'Firewall two' }),
      ],
    });

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('firewall');

    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-task-t1');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-task-t2');
  });

  it('navigates to a task and fires the row-focus event on Enter', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    const focusEvents: string[] = [];
    const listener = (event_: Event) => {
      focusEvents.push((event_ as CustomEvent<{ id: string }>).detail.id);
    };
    globalThis.addEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);

    renderSearchBox({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('firewall');
    await user.keyboard('{Enter}');

    expect(pushState).toHaveBeenCalledWith(null, '', '/?view=inbox');
    expect(focusEvents).toContain('t1');
    globalThis.removeEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);
  });

  it('closes the dropdown and clears the query on Escape', async () => {
    const user = userEvent.setup();
    renderSearchBox({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('firewall');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});
