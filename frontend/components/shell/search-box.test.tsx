import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { SearchBox } from '@/components/shell/search-box';
import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';
import { CodeProvider } from '@/lib/stores/code-store';
import { ExpansionProvider } from '@/lib/stores/expansion-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { SearchProvider } from '@/lib/stores/search-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import { WikiProvider } from '@/lib/stores/wiki-store';
import type { CodeStory, Item, WikiPageIndexRow } from '@/lib/types';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

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
    sort_order: 0,
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
    blocked_from: null,
    requires_refinement: true,
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
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

function renderSearchBox(
  seed: { tasks?: Item[]; stories?: CodeStory[]; pages?: WikiPageIndexRow[] } = {},
) {
  return render(
    <ToastProvider>
      <WikiProvider
        initialPages={seed.pages ?? []}
        initialSync={null}
        config={{ repo: null, writable: false }}
      >
        <FoldersProvider initialFolders={[]}>
          <ExpansionProvider>
            <TasksProvider initialTasks={seed.tasks ?? []}>
              <CodeProvider
                initialProjects={[]}
                initialEpics={[]}
                initialStories={seed.stories ?? []}
              >
                <SearchProvider>
                  <SearchBox placement="desktop" />
                </SearchProvider>
              </CodeProvider>
            </TasksProvider>
          </ExpansionProvider>
        </FoldersProvider>
      </WikiProvider>
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

  it('opens the dropdown and filters across tasks, stories and wiki pages as you type', async () => {
    const user = userEvent.setup();
    renderSearchBox({
      tasks: [
        makeItem({ id: 't1', title: 'Firewall triage UI' }),
        makeItem({ id: 't2', title: 'Buy groceries' }),
      ],
      stories: [makeStory()],
      pages: [toWikiIndexRow(makeWikiPage('wiki/concepts/firewall.md', { title: 'Firewall' }))],
    });

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('firewall');

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('Firewall triage UI')).toBeInTheDocument();
    expect(within(listbox).getByText('Firewall triage story')).toBeInTheDocument();
    expect(within(listbox).getByText('Firewall')).toBeInTheDocument();
    expect(within(listbox).queryByText('Buy groceries')).not.toBeInTheDocument();
  });

  it('shows a Wiki group with the wiki badge and the new empty-query copy', async () => {
    const user = userEvent.setup();
    renderSearchBox({
      pages: [
        toWikiIndexRow(
          makeWikiPage('wiki/concepts/habit-stacking.md', { title: 'Habit stacking' }),
        ),
      ],
    });

    const input = screen.getByRole('combobox', { name: 'Search tasks, stories, and wiki pages' });
    await user.click(input);
    expect(screen.getByText('Search tasks, stories, and wiki pages')).toBeInTheDocument();

    await user.keyboard('habit');
    const listbox = await screen.findByRole('listbox');
    // "Wiki" appears twice: the group label and the row's badge.
    expect(within(listbox).getAllByText('Wiki')).toHaveLength(2);
    const row = within(listbox).getByText('Habit stacking').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Wiki')).toBeInTheDocument();
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

  it('moves the active option with ArrowDown across the tasks → wiki group boundary', async () => {
    const user = userEvent.setup();
    renderSearchBox({
      tasks: [makeItem({ id: 't1', title: 'Firewall task' })],
      pages: [
        toWikiIndexRow(makeWikiPage('wiki/concepts/firewall.md', { title: 'Firewall page' })),
      ],
    });

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('firewall');

    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-task-t1');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      `search-option-wiki-${encodeURIComponent('wiki/concepts/firewall.md')}`,
    );
  });

  it('moves across all three groups, keeping each row aria-selected in sync with the activedescendant', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    renderSearchBox({
      tasks: [makeItem({ id: 't1', title: 'Firewall task' })],
      stories: [makeStory({ item_id: 's1', title: 'Firewall story' })],
      pages: [
        toWikiIndexRow(makeWikiPage('wiki/concepts/firewall.md', { title: 'Firewall page' })),
      ],
    });

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('firewall');

    const wikiOptionId = `search-option-wiki-${encodeURIComponent('wiki/concepts/firewall.md')}`;
    const wikiRow = screen.getByRole('option', { name: /Firewall page/ });
    const storyRow = screen.getByRole('option', { name: /Firewall story/ });

    // Task → Story → Wiki. Every group's baseIndex must land the wiki row at its own index,
    // never overlapping the story group's — a wrong baseIndex would make two rows claim the
    // same activedescendant, or leave a row's own aria-selected out of sync with it.
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-task-t1');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-story-s1');
    expect(storyRow).toHaveAttribute('aria-selected', 'true');
    expect(wikiRow).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', wikiOptionId);
    expect(wikiRow).toHaveAttribute('aria-selected', 'true');
    expect(storyRow).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-story-s1');
    expect(storyRow).toHaveAttribute('aria-selected', 'true');
    expect(wikiRow).toHaveAttribute('aria-selected', 'false');

    // Hovering the wiki row makes it active without the keyboard, and Enter opens it.
    await user.hover(wikiRow);
    expect(input).toHaveAttribute('aria-activedescendant', wikiOptionId);
    await user.keyboard('{Enter}');

    expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/firewall');
  });

  it('gives each result kind its own badge variant class', async () => {
    const user = userEvent.setup();
    renderSearchBox({
      tasks: [makeItem({ id: 't1', title: 'Firewall task' })],
      stories: [makeStory({ item_id: 's1', title: 'Firewall story' })],
      pages: [
        toWikiIndexRow(makeWikiPage('wiki/concepts/firewall.md', { title: 'Firewall page' })),
      ],
    });

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('firewall');

    const taskRow = screen.getByRole('option', { name: /Firewall task/ });
    const storyRow = screen.getByRole('option', { name: /Firewall story/ });
    const wikiRow = screen.getByRole('option', { name: /Firewall page/ });

    // A swapped or missing entry in the kind→badge lookup shows up as the wrong variant class,
    // not just the wrong label — pin the class, not only the text.
    expect(within(taskRow).getByText('Task')).toHaveClass('bg-accent-teal/15');
    expect(within(storyRow).getByText('Code')).toHaveClass('bg-amber-500/15');
    expect(within(wikiRow).getByText('Wiki')).toHaveClass('bg-accent-violet/15');
  });

  it('selects a wiki result on Enter, pushing its /wiki/<section>/<name> href', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    renderSearchBox({
      pages: [
        toWikiIndexRow(
          makeWikiPage('wiki/concepts/habit-stacking.md', { title: 'Habit stacking' }),
        ),
      ],
    });

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('habit');
    await user.keyboard('{Enter}');

    expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/habit-stacking');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
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

  describe('completed items', () => {
    it('does not show the "Show completed" checkbox before typing a query', async () => {
      const user = userEvent.setup();
      renderSearchBox({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });

      await user.click(screen.getByRole('combobox'));
      expect(screen.queryByRole('checkbox', { name: 'Show completed' })).not.toBeInTheDocument();
    });

    it('hides completed tasks and terminal stories by default, revealing them via the checkbox', async () => {
      const user = userEvent.setup();
      renderSearchBox({
        tasks: [
          makeItem({ id: 't1', title: 'Firewall active task' }),
          makeItem({ id: 't2', title: 'Firewall done task', status: 'completed' }),
        ],
        stories: [
          makeStory({ item_id: 's1', title: 'Firewall done story', factory_state: 'done' }),
        ],
      });

      await user.click(screen.getByRole('combobox'));
      await user.keyboard('firewall');

      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getByText('Firewall active task')).toBeInTheDocument();
      expect(within(listbox).queryByText('Firewall done task')).not.toBeInTheDocument();
      expect(within(listbox).queryByText('Firewall done story')).not.toBeInTheDocument();

      await user.click(screen.getByRole('checkbox', { name: 'Show completed' }));

      const revealed = await screen.findByRole('listbox');
      expect(within(revealed).getByText('Firewall done task')).toBeInTheDocument();
      expect(within(revealed).getByText('Firewall done story')).toBeInTheDocument();
    });

    it('shows the checkbox even with zero visible results, so a hidden match can be revealed', async () => {
      const user = userEvent.setup();
      renderSearchBox({
        tasks: [makeItem({ id: 't1', title: 'Firewall done task', status: 'completed' })],
      });

      await user.click(screen.getByRole('combobox'));
      await user.keyboard('firewall');

      expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Show completed' })).toBeInTheDocument();

      await user.click(screen.getByRole('checkbox', { name: 'Show completed' }));
      expect(await screen.findByText('Firewall done task')).toBeInTheDocument();
    });
  });
});
