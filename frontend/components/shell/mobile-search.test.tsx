import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { MobileSearch } from '@/components/shell/mobile-search';
import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';
import { SearchProvider } from '@/lib/stores/search-store';
import { renderWithProviders } from '@/lib/test-utils';
import type { CodeStory, Item, WikiPageIndexRow } from '@/lib/types';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

// The sheet only exists below `md`; report NO match for the `(min-width: 768px)` query so the
// component believes it's on a phone.
function mockViewport({ desktop }: { desktop: boolean }) {
  jest.spyOn(globalThis, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: desktop && query.includes('min-width'),
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

function renderMobileSearch(
  seed: { tasks?: Item[]; stories?: CodeStory[]; pages?: WikiPageIndexRow[] } = {},
) {
  return renderWithProviders(
    <SearchProvider>
      <MobileSearch />
    </SearchProvider>,
    { tasks: seed.tasks ?? [], stories: seed.stories ?? [], wiki: { pages: seed.pages ?? [] } },
  );
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Search' }));
  return screen.findByRole('dialog', { name: 'Search' });
}

function pressSearchShortcut() {
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    globalThis.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MobileSearch on a narrow viewport', () => {
  beforeEach(() => {
    mockViewport({ desktop: false });
  });

  it('opens a full-screen "Search" sheet with its combobox focused', async () => {
    const user = userEvent.setup();
    renderMobileSearch();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const dialog = await openSheet(user);
    const input = within(dialog).getByRole('combobox', {
      name: 'Search tasks, stories, and wiki pages',
    });
    expect(input).toHaveFocus();
    // The desktop field's ⌘P hint has no place on a phone.
    expect(within(dialog).queryByText('⌘P')).not.toBeInTheDocument();
  });

  it('renders grouped, touch-sized options inside the dialog as you type', async () => {
    const user = userEvent.setup();
    renderMobileSearch({
      tasks: [
        makeItem({ id: 't1', title: 'Firewall triage UI' }),
        makeItem({ id: 't2', title: 'Buy groceries' }),
      ],
      stories: [makeStory()],
      pages: [toWikiIndexRow(makeWikiPage('wiki/concepts/firewall.md', { title: 'Firewall' }))],
    });

    const dialog = await openSheet(user);
    await user.keyboard('firewall');

    const listbox = within(dialog).getByRole('listbox');
    expect(listbox).toHaveAttribute('id', 'global-search-results-mobile');
    expect(within(listbox).getByText('Tasks')).toBeInTheDocument();
    expect(within(listbox).getByText('Stories')).toBeInTheDocument();
    expect(within(listbox).getByText('Firewall triage UI')).toBeInTheDocument();
    expect(within(listbox).getByText('Firewall triage story')).toBeInTheDocument();
    expect(within(listbox).queryByText('Buy groceries')).not.toBeInTheDocument();
    // Touch density: every row meets the 44px mobile tap target.
    for (const option of within(listbox).getAllByRole('option')) {
      expect(option).toHaveClass('min-h-11');
    }
  });

  it('shows the count in a status row with no key-hint footer, only once there is a query', async () => {
    const user = userEvent.setup();
    renderMobileSearch({
      tasks: [
        makeItem({ id: 't1', title: 'Firewall one' }),
        makeItem({ id: 't2', title: 'Firewall two' }),
      ],
    });

    const dialog = await openSheet(user);
    expect(within(dialog).getByText('Search tasks, stories, and wiki pages')).toBeInTheDocument();
    expect(within(dialog).queryByText(/results?$/)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Show completed' }),
    ).not.toBeInTheDocument();

    await user.keyboard('firewall');

    const status = within(dialog).getByTestId('search-status-row');
    expect(within(status).getByText('2 results')).toBeInTheDocument();
    expect(within(status).getByRole('checkbox', { name: 'Show completed' })).toBeInTheDocument();
    expect(within(dialog).queryByText('↑↓ navigate')).not.toBeInTheDocument();
  });

  it('shows the no-match message for a query that matches nothing', async () => {
    const user = userEvent.setup();
    renderMobileSearch({ tasks: [makeItem({ id: 't1', title: 'Firewall one' })] });

    const dialog = await openSheet(user);
    await user.keyboard('zzz');

    expect(within(dialog).getByText('No matches for “zzz”')).toBeInTheDocument();
    expect(within(dialog).getByText('0 results')).toBeInTheDocument();
  });

  it('reveals a de-emphasised completed row via Show completed', async () => {
    const user = userEvent.setup();
    renderMobileSearch({
      tasks: [
        makeItem({ id: 't1', title: 'Firewall active task' }),
        makeItem({ id: 't2', title: 'Firewall done task', status: 'completed' }),
      ],
    });

    const dialog = await openSheet(user);
    await user.keyboard('firewall');
    expect(within(dialog).queryByText('Firewall done task')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Show completed' }));

    const doneRow = within(dialog).getByRole('option', { name: /Firewall done task/ });
    expect(doneRow).toHaveClass('opacity-60');
    expect(within(dialog).getByRole('option', { name: /Firewall active task/ })).not.toHaveClass(
      'opacity-60',
    );
  });

  it('navigates to a chosen task, closes the sheet, and reopens empty', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    const focusEvents: string[] = [];
    const listener = (event_: Event) => {
      focusEvents.push((event_ as CustomEvent<{ id: string }>).detail.id);
    };
    globalThis.addEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);
    renderMobileSearch({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });

    const dialog = await openSheet(user);
    await user.keyboard('firewall');
    await user.click(within(dialog).getByRole('option', { name: /Firewall triage UI/ }));

    expect(pushState).toHaveBeenCalledWith(null, '', '/?view=inbox');
    expect(focusEvents).toContain('t1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    globalThis.removeEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);

    const reopened = await openSheet(user);
    expect(within(reopened).getByRole('combobox')).toHaveValue('');
  });

  it('opens the active (first) option on Enter — the keyboard Go key', async () => {
    const user = userEvent.setup();
    const pushState = jest.spyOn(globalThis.history, 'pushState');
    renderMobileSearch({
      pages: [
        toWikiIndexRow(
          makeWikiPage('wiki/concepts/habit-stacking.md', { title: 'Habit stacking' }),
        ),
      ],
    });

    const dialog = await openSheet(user);
    const input = within(dialog).getByRole('combobox');
    expect(input).toHaveAttribute('enterkeyhint', 'go');
    await user.keyboard('habit');
    expect(within(dialog).getByRole('option', { name: /Habit stacking/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Enter}');

    expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/habit-stacking');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on × and clears the query and Show completed', async () => {
    const user = userEvent.setup();
    renderMobileSearch({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });

    const dialog = await openSheet(user);
    await user.keyboard('firewall');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Show completed' }));
    await user.click(within(dialog).getByRole('button', { name: 'Close search' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const reopened = await openSheet(user);
    expect(within(reopened).getByRole('combobox')).toHaveValue('');
    await user.keyboard('firewall');
    expect(within(reopened).getByRole('checkbox', { name: 'Show completed' })).not.toBeChecked();
  });

  it('closes on Escape and clears the query', async () => {
    const user = userEvent.setup();
    renderMobileSearch({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });

    await openSheet(user);
    await user.keyboard('firewall');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const reopened = await openSheet(user);
    expect(within(reopened).getByRole('combobox')).toHaveValue('');
  });

  it('blurs the field (dismissing the keyboard) when the results are dragged, keeping the sheet', async () => {
    const user = userEvent.setup();
    renderMobileSearch({ tasks: [makeItem({ id: 't1', title: 'Firewall triage UI' })] });

    const dialog = await openSheet(user);
    await user.keyboard('firewall');
    const input = within(dialog).getByRole('combobox');
    expect(input).toHaveFocus();

    // Radix's scroll lock reads the touch point off every touchmove, so the event needs one.
    const touch = { clientX: 0, clientY: 100 };
    fireEvent.touchMove(within(dialog).getByTestId('search-results-region'), {
      touches: [touch],
      changedTouches: [touch],
    });

    expect(input).not.toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(input).toHaveValue('firewall');
    expect(within(dialog).getByRole('option', { name: /Firewall triage UI/ })).toBeInTheDocument();
  });

  it('opens the sheet on Ctrl/⌘P, claiming the key from the browser', async () => {
    renderMobileSearch();

    const event = pressSearchShortcut();

    expect(event.defaultPrevented).toBe(true);
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    expect(within(dialog).getByRole('combobox')).toHaveFocus();
  });
});

describe('MobileSearch on a wide viewport', () => {
  beforeEach(() => {
    mockViewport({ desktop: true });
  });

  it('never opens the sheet and leaves ⌘P to the header field', async () => {
    const user = userEvent.setup();
    renderMobileSearch();

    const event = pressSearchShortcut();
    expect(event.defaultPrevented).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
