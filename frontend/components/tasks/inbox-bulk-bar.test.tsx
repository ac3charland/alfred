import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { CodeItem, Epic, Folder, Item, Project } from '@/lib/types';

import { InboxBulkBar, InboxSelectToggle } from './inbox-bulk-bar';
import { TaskList } from './task-list';

jest.mock('@/lib/api-client');
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockEnterCodeModule = jest.mocked(apiClient.enterCodeModule);

const BASE: Item = {
  id: 'item-1',
  title: 'Task',
  notes: null,
  source_url: null,
  item_type: 'unclassified',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
};

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return { ...BASE, id, title: id, ...overrides };
}

const FOLDERS: Folder[] = [
  { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z', sort_order: 1 },
];

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 0,
  created_at: '2025-01-01T00:00:00Z',
};

const EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Firewall',
  notes: null,
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};

/** The sidecar row the gate's API call resolves with, one per admitted item. */
function makeSidecar(itemId: string, refNumber: number): CodeItem {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: refNumber,
    ref: `ALF-${String(refNumber)}`,
    factory_state: 'needs_refinement',
    lane: 'human',
    requires_refinement: true,
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    created_at: '2025-01-02T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    priority: 1,
  };
}

/** The Inbox in select mode: the header toggle, the selectable list, and the bulk bar. */
function InboxHarness() {
  return (
    <>
      <InboxSelectToggle />
      <TaskList scope={{ type: 'inbox' }} selectable />
      <InboxBulkBar />
    </>
  );
}

function renderInbox(
  tasks: Item[],
  folders: Folder[] = FOLDERS,
  code: { projects?: Project[]; epics?: Epic[] } = {},
) {
  return renderWithProviders(<InboxHarness />, {
    tasks,
    folders,
    projects: code.projects ?? [],
    epics: code.epics ?? [],
  });
}

/** Open a bar dropdown by clicking its trigger, then activate `item` via keyboard (Radix
 * blocks pointer clicks on portalled items in jsdom — see task-row.test). */
async function pickFromMenu(
  user: ReturnType<typeof userEvent.setup>,
  trigger: RegExp,
  item: RegExp,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: trigger }));
  const target = await screen.findByRole('menuitem', { name: item });
  const count = screen.getAllByRole('menuitem').length;
  for (let index = 0; index < count; index += 1) {
    if (document.activeElement === target) break;
    await user.keyboard('[ArrowDown]');
  }
  await user.keyboard('[Enter]');
}

describe('Inbox select mode', () => {
  it('enters select mode: rows become selection checkboxes, no bar until one is picked', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1', { title: 'Email the accountant' })]);

    // Idle: a normal row, no selection control.
    expect(screen.queryByRole('button', { name: /select "email the accountant"/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(
      screen.getByRole('button', { name: /select "email the accountant"/i }),
    ).toBeInTheDocument();
    // No items selected yet → no action bar.
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('toggling rows updates the live count and shows the bar', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1'), makeItem('u2')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "u2"/i }));

    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 selected');

    // Deselecting one drops the count.
    await user.click(screen.getByRole('button', { name: /deselect "u1"/i }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
  });

  it('gates Classify by shape (childless roots) and Move by type (task/unclassified)', async () => {
    // ALF-170 re-derived the gates: correcting a type is the common case now, so Classify is
    // enabled on any selection of childless roots whatever their current types; Move widens to
    // unclassified rows (filing classifies them) but still refuses a code row.
    const user = userEvent.setup();
    renderInbox([
      makeItem('u1', { item_type: 'unclassified' }),
      makeItem('t1', { item_type: 'task' }),
      makeItem('c1', { item_type: 'code' }),
      makeItem('parent', { item_type: 'task' }),
      makeItem('child', { item_type: 'task', parent_id: 'parent' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Select' }));

    // A mixed unclassified + task selection: both actions live (all childless roots, all fileable).
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "t1"/i }));
    expect(screen.getByRole('button', { name: /classify as/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeEnabled();

    // Adding a code row: Classify stays live (a childless root carries a type to correct);
    // Move disables — folders hold tasks.
    await user.click(screen.getByRole('button', { name: /select "c1"/i }));
    expect(screen.getByRole('button', { name: /classify as/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeDisabled();

    // Swapping in a decomposed task: Classify disables (the shape gate — a parent's flip is
    // the one the database can't catch); Move re-enables.
    await user.click(screen.getByRole('button', { name: /deselect "c1"/i }));
    await user.click(screen.getByRole('button', { name: /select "parent"/i }));
    expect(screen.getByRole('button', { name: /classify as/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeEnabled();
  });

  it('disables Send to Code with a hint when any selected row has children (ALF-129)', async () => {
    const user = userEvent.setup();
    renderInbox([
      makeItem('flat', { item_type: 'code' }),
      makeItem('parent', { item_type: 'code' }),
      makeItem('child', { item_type: 'code', parent_id: 'parent' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Select' }));

    // A childless selection sends as usual.
    await user.click(screen.getByRole('button', { name: /select "flat"/i }));
    expect(screen.getByRole('button', { name: /send to code/i })).toBeEnabled();

    // Adding the epic-shaped parent disables the bulk send (its own row menu converts it).
    await user.click(screen.getByRole('button', { name: /select "parent"/i }));
    const send = screen.getByRole('button', { name: /send to code/i });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', expect.stringMatching(/row menu/i));
  });

  it('Esc exits select mode and clears the selection', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('Classify → Task patches every selected item and exits on full success', async () => {
    mockUpdateItem.mockImplementation((id) => Promise.resolve(makeItem(id, { item_type: 'task' })));
    const user = userEvent.setup();
    renderInbox([makeItem('u1'), makeItem('u2')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "u2"/i }));

    await pickFromMenu(user, /classify as/i, /^task$/i);

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('u1', { item_type: 'task' });
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('u2', { item_type: 'task' });
    // Full success → back to idle.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('Move → folder files every selected task into the chosen folder', async () => {
    mockUpdateItem.mockImplementation((id) =>
      Promise.resolve(makeItem(id, { item_type: 'task', folder_id: 'f1' })),
    );
    const user = userEvent.setup();
    renderInbox([makeItem('t1', { item_type: 'task' }), makeItem('t2', { item_type: 'task' })]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "t1"/i }));
    await user.click(screen.getByRole('button', { name: /select "t2"/i }));

    await pickFromMenu(user, /move to folder/i, /^work$/i);

    await waitFor(() => {
      // Filing IS the dispatch: location and residency move together, in one write per row.
      expect(mockUpdateItem).toHaveBeenCalledWith('t1', { folder_id: 'f1', dispatched: true });
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('t2', { folder_id: 'f1', dispatched: true });
  });

  it('a partial failure keeps only the failed item selected for retry', async () => {
    // u1 saves, u2 fails.
    mockUpdateItem.mockImplementation((id) =>
      id === 'u2'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(makeItem(id, { item_type: 'task' })),
    );
    const user = userEvent.setup();
    renderInbox([makeItem('u1'), makeItem('u2')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "u2"/i }));

    await pickFromMenu(user, /classify as/i, /^task$/i);

    // Still in select mode with just the failed item selected.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    });
    expect(screen.getByRole('button', { name: /deselect "u2"/i })).toBeInTheDocument();
  });

  it('Send to Code → the confirmation toast deep-links to the board it sent them to', async () => {
    mockEnterCodeModule.mockImplementation((itemId) =>
      Promise.resolve(makeSidecar(itemId, itemId === 'c1' ? 42 : 43)),
    );
    const user = userEvent.setup();
    renderInbox(
      [makeItem('c1', { item_type: 'code' }), makeItem('c2', { item_type: 'code' })],
      [],
      {
        projects: [PROJECT],
        epics: [EPIC],
      },
    );

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "c1"/i }));
    await user.click(screen.getByRole('button', { name: /select "c2"/i }));
    await user.click(screen.getByRole('button', { name: /send to code/i }));

    const gate = await screen.findByRole('dialog', { name: /send to code module/i });
    await user.click(await within(gate).findByRole('option', { name: /alfred/i }));
    await user.click(await within(gate).findByRole('option', { name: /firewall/i }));
    await user.click(within(gate).getByRole('button', { name: /send to code module/i }));

    // A batch has no single story to open, so the toast lands on the project's board — where
    // all of them just arrived — rather than staying inert text.
    expect(await screen.findByRole('link', { name: 'Sent 2 items to Code' })).toHaveAttribute(
      'href',
      '/code/p1',
    );
  });
});

// ---------------------------------------------------------------------------
// ALF-170 — Dispatch, the readiness line, and the select-mode metadata cluster
// ---------------------------------------------------------------------------

/** Enter select mode and select each of `titles`. */
async function selectRows(
  user: ReturnType<typeof userEvent.setup>,
  titles: string[],
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Select' }));
  for (const title of titles) {
    await user.click(screen.getByRole('button', { name: new RegExp(`select "${title}"`, 'i') }));
  }
}

describe('Dispatch (ALF-170)', () => {
  it('leads the bar, disabled with a hint while nothing selected is ready', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1', { item_type: 'unclassified' })]);

    await selectRows(user, ['u1']);

    const bar = screen.getByRole('region', { name: /bulk actions/i });
    const [first] = within(bar).getAllByRole('button');
    expect(first).toHaveAccessibleName('Dispatch');
    expect(first).toBeDisabled();
    expect(first).toHaveAttribute('title', 'Nothing in the selection is ready to dispatch');
  });

  it('names what the selection is missing, grouped by reason, updating live', async () => {
    const user = userEvent.setup();
    renderInbox([
      makeItem('bare task', { item_type: 'task' }),
      makeItem('bare code', { item_type: 'code' }),
      makeItem('ready task', { item_type: 'task', folder_id: 'f1', dispatched_at: null }),
    ]);

    await selectRows(user, ['bare task', 'bare code']);
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 not ready — 1 needs a folder, 1 needs a project',
    );

    // Selecting a ready row leaves the line about the other two…
    await user.click(screen.getByRole('button', { name: /select "ready task"/i }));
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 not ready — 1 needs a folder, 1 needs a project',
    );

    // …and dropping the unready rows clears it entirely.
    await user.click(screen.getByRole('button', { name: /deselect "bare task"/i }));
    await user.click(screen.getByRole('button', { name: /deselect "bare code"/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sends a mixed selection: task subtree PATCHed, code item gated, unready row left selected', async () => {
    mockUpdateItem.mockImplementation((id) =>
      Promise.resolve(
        makeItem(id, { item_type: 'task', folder_id: 'f1', dispatched_at: '2025-01-02T00:00:00Z' }),
      ),
    );
    mockEnterCodeModule.mockResolvedValue(makeSidecar('ready code', 42));
    const user = userEvent.setup();
    renderInbox(
      [
        makeItem('ready task', { item_type: 'task', folder_id: 'f1', dispatched_at: null }),
        makeItem('subtask', {
          item_type: 'task',
          parent_id: 'ready task',
          folder_id: 'f1',
          dispatched_at: null,
        }),
        makeItem('ready code', {
          item_type: 'code',
          intended_project_id: 'p1',
          intended_epic_id: 'e1',
        }),
        makeItem('not ready', { item_type: 'task' }),
      ],
      FOLDERS,
      { projects: [PROJECT], epics: [EPIC] },
    );

    await selectRows(user, ['ready task', 'ready code', 'not ready']);
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));

    // The ready task and its whole subtree got the residency PATCH…
    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('ready task', { dispatched: true });
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('subtask', { dispatched: true });
    // …the ready code item went through the gate RPC with its own hints, no dialog…
    expect(mockEnterCodeModule).toHaveBeenCalledWith('ready code', 'p1', 'e1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // …the toast counts what went, with no deep link (a mixed dispatch has no one destination)…
    const toast = await screen.findByText('Dispatched 2 items');
    expect(toast.closest('a')).toBeNull();
    // …and the unready row stays selected with the readiness line still naming its blocker.
    expect(screen.getByRole('button', { name: /deselect "not ready"/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 not ready — 1 needs a folder');
    // The dispatched rows have left the Inbox view.
    expect(screen.queryByText('ready task')).not.toBeInTheDocument();
    expect(screen.queryByText('ready code')).not.toBeInTheDocument();
  });
});

describe('select mode keeps the label chips, inert (S13)', () => {
  it('renders the metadata cluster inside the row button with no nested interactive element', async () => {
    const user = userEvent.setup();
    renderInbox(
      [
        makeItem('labelled', {
          item_type: 'task',
          folder_id: 'f1',
          dispatched_at: null,
          due_date: '2099-12-31',
          priority: 'high',
        }),
      ],
      FOLDERS,
    );

    await user.click(screen.getByRole('button', { name: 'Select' }));

    const row = screen.getByRole('button', { name: /select "labelled"/i });
    // The labels the dispatch decision rests on are visible…
    expect(within(row).getByText('Task')).toBeInTheDocument();
    expect(within(row).getByText('Work')).toBeInTheDocument();
    expect(within(row).getByText(/dec 31/i)).toBeInTheDocument();
    // …and none of them is a control: a button inside a button is invalid HTML, and a click
    // here has exactly one meaning. Assert the absence, or the nested-button bug returns the
    // first time someone reuses the ordinary row's chip component in this branch.
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  it('a click anywhere on the row — a chip included — only toggles selection', async () => {
    const user = userEvent.setup();
    renderInbox(
      [makeItem('labelled', { item_type: 'task', folder_id: 'f1', dispatched_at: null })],
      FOLDERS,
    );

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByText('Work'));

    expect(screen.getByRole('button', { name: /deselect "labelled"/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // No picker opened — the chip is inert here.
    expect(screen.queryByRole('button', { name: 'No folder' })).not.toBeInTheDocument();
  });
});
