import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeProvider } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeItem, Epic, Project } from '@/lib/types';

import { GateDialog, type GateItem } from './gate-dialog';

// Since ALF-27 the gate reads the project/epic lists from the CodeProvider and routes its
// creates + the send through the store's optimistic actions, which call api-client under the
// hood. Mock that seam; seed the lists by wrapping in a CodeProvider.
jest.mock('@/lib/api-client');
const mockCreateProject = jest.mocked(api.createProject);
const mockCreateEpic = jest.mocked(api.createEpic);
const mockEnterCodeModule = jest.mocked(api.enterCodeModule);

const ITEM: GateItem = { id: 'item-1', title: 'Ship the webhook', notes: null, source_url: null };

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
  name: 'Communication Firewall',
  notes: null,
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
};

const SIDECAR: CodeItem = {
  item_id: 'item-1',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 42,
  ref: 'ALF-42',
  factory_state: 'needs_refinement',
  lane: 'human',
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  implementation_pr_url: null,
  blocked_reason: null,
  created_at: '2025-01-02T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
  priority: 1,
};

function renderGate(
  overrides: Partial<React.ComponentProps<typeof GateDialog>> = {},
  seed: { projects?: Project[]; epics?: Epic[] } = {},
) {
  const onComplete = overrides.onComplete ?? jest.fn();
  const onOpenChange = overrides.onOpenChange ?? jest.fn();
  render(
    <ToastProvider>
      <CodeProvider
        initialProjects={seed.projects ?? [PROJECT]}
        initialEpics={seed.epics ?? [EPIC]}
        initialStories={[]}
      >
        <GateDialog
          open
          onOpenChange={onOpenChange}
          items={overrides.items ?? [ITEM]}
          onComplete={onComplete}
        />
      </CodeProvider>
    </ToastProvider>,
  );
  return { onComplete, onOpenChange };
}

describe('GateDialog', () => {
  it('lists the seeded projects on open', async () => {
    renderGate();
    expect(await screen.findByRole('option', { name: /alfred/i })).toBeInTheDocument();
  });

  it('disables Confirm until BOTH a project and an epic are chosen', async () => {
    const user = userEvent.setup();
    renderGate();

    const confirm = screen.getByRole('button', { name: /send to code module/i });
    expect(confirm).toBeDisabled();

    // Pick the project — epics load, but no epic chosen yet → still disabled.
    await user.click(await screen.findByRole('option', { name: /alfred/i }));
    expect(await screen.findByRole('option', { name: /communication firewall/i })).toBeVisible();
    expect(confirm).toBeDisabled();

    // Pick the epic → now enabled.
    await user.click(screen.getByRole('option', { name: /communication firewall/i }));
    expect(confirm).toBeEnabled();
  });

  it('shows "Pick a project first" until a project is selected', async () => {
    const user = userEvent.setup();
    renderGate();
    await screen.findByRole('option', { name: /alfred/i });

    expect(screen.getByText(/pick a project first/i)).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /alfred/i }));
    await waitFor(() => {
      expect(screen.queryByText(/pick a project first/i)).not.toBeInTheDocument();
    });
  });

  it('routes the send through the store and fires onComplete with the reconciled story', async () => {
    mockEnterCodeModule.mockResolvedValue(SIDECAR);
    const user = userEvent.setup();
    const { onComplete } = renderGate();

    await user.click(await screen.findByRole('option', { name: /alfred/i }));
    await user.click(await screen.findByRole('option', { name: /communication firewall/i }));
    await user.click(screen.getByRole('button', { name: /send to code module/i }));

    await waitFor(() => {
      expect(mockEnterCodeModule).toHaveBeenCalledWith('item-1', 'p1', 'e1');
    });
    // onComplete gets the batch of flattened, reconciled CodeStories (carrying the allocated
    // ref), not the raw sidecar. A single-item send yields a one-element array.
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ item_id: 'item-1', ref: 'ALF-42' }),
    ]);
  });

  it('admits a batch under one project + epic and fires onComplete with every story', async () => {
    mockEnterCodeModule.mockImplementation((itemId: string) =>
      Promise.resolve({ ...SIDECAR, item_id: itemId, ref: `ALF-${itemId}` }),
    );
    const user = userEvent.setup();
    const { onComplete } = renderGate({
      items: [
        { id: 'i1', title: 'First capture', notes: null, source_url: null },
        { id: 'i2', title: 'Second capture', notes: null, source_url: null },
      ],
    });

    // Pluralized copy reflects the count.
    expect(screen.getByText(/assign these/i)).toHaveTextContent('2 items');

    await user.click(await screen.findByRole('option', { name: /alfred/i }));
    await user.click(await screen.findByRole('option', { name: /communication firewall/i }));
    await user.click(screen.getByRole('button', { name: /send to code module/i }));

    await waitFor(() => {
      expect(mockEnterCodeModule).toHaveBeenCalledWith('i1', 'p1', 'e1');
    });
    expect(mockEnterCodeModule).toHaveBeenCalledWith('i2', 'p1', 'e1');
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ item_id: 'i1' }),
      expect.objectContaining({ item_id: 'i2' }),
    ]);
  });

  describe('New project sub-dialog', () => {
    it('validates the 3-char key and shows the ALF-12 preview', async () => {
      const user = userEvent.setup();
      renderGate();
      await screen.findByRole('option', { name: /alfred/i });

      await user.click(screen.getByRole('button', { name: /new project…/i }));
      const dialog = await screen.findByRole('dialog', { name: /new project/i });

      // A too-short key keeps the create button disabled and shows the rule, not a preview.
      await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Relay');
      await user.type(
        within(dialog).getByRole('textbox', { name: /github link/i }),
        'https://github.com/ac3charland/relay',
      );
      const keyInput = within(dialog).getByRole('textbox', { name: /ticket key/i });
      await user.type(keyInput, 'RL');
      expect(within(dialog).getByRole('button', { name: /create project/i })).toBeDisabled();

      // A valid key shows the live "Refs will look like RLP-12" preview + enables create.
      await user.type(keyInput, 'P');
      expect(within(dialog).getByText(/refs will look like/i)).toBeInTheDocument();
      expect(within(dialog).getByText('RLP-12')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /create project/i })).toBeEnabled();
    });

    it('lowercase typing is upper-cased into the key', async () => {
      const user = userEvent.setup();
      renderGate();
      await screen.findByRole('option', { name: /alfred/i });
      await user.click(screen.getByRole('button', { name: /new project…/i }));
      const dialog = await screen.findByRole('dialog', { name: /new project/i });

      const keyInput = within(dialog).getByRole('textbox', { name: /ticket key/i });
      await user.type(keyInput, 'rlp');
      expect(keyInput).toHaveValue('RLP');
    });

    it('rejects a non-github URL (create stays disabled, shows a hint)', async () => {
      const user = userEvent.setup();
      renderGate();
      await screen.findByRole('option', { name: /alfred/i });
      await user.click(screen.getByRole('button', { name: /new project…/i }));
      const dialog = await screen.findByRole('dialog', { name: /new project/i });

      await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Relay');
      await user.type(within(dialog).getByRole('textbox', { name: /github link/i }), 'not-a-url');
      await user.type(within(dialog).getByRole('textbox', { name: /ticket key/i }), 'RLP');

      expect(within(dialog).getByText(/valid github\.com repository url/i)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /create project/i })).toBeDisabled();
    });

    it('rejects a key already in use by an existing project', async () => {
      const user = userEvent.setup();
      renderGate();
      await screen.findByRole('option', { name: /alfred/i });
      await user.click(screen.getByRole('button', { name: /new project…/i }));
      const dialog = await screen.findByRole('dialog', { name: /new project/i });

      await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Dup');
      await user.type(
        within(dialog).getByRole('textbox', { name: /github link/i }),
        'https://github.com/ac3charland/dup',
      );
      // ALF is already taken by the seeded project.
      await user.type(within(dialog).getByRole('textbox', { name: /ticket key/i }), 'ALF');

      expect(within(dialog).getByText(/already in use/i)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /create project/i })).toBeDisabled();
    });

    it('creates via the store, then inserts and auto-selects the project', async () => {
      const created: Project = {
        ...PROJECT,
        id: 'p2',
        name: 'Relay',
        key: 'RLP',
        repo_name: 'relay',
      };
      mockCreateProject.mockResolvedValue(created);
      const user = userEvent.setup();
      renderGate();
      await screen.findByRole('option', { name: /alfred/i });

      await user.click(screen.getByRole('button', { name: /new project…/i }));
      const dialog = await screen.findByRole('dialog', { name: /new project/i });
      await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Relay');
      await user.type(
        within(dialog).getByRole('textbox', { name: /github link/i }),
        'https://github.com/ac3charland/relay',
      );
      await user.type(within(dialog).getByRole('textbox', { name: /ticket key/i }), 'RLP');
      await user.click(within(dialog).getByRole('button', { name: /create project/i }));

      await waitFor(() => {
        expect(mockCreateProject).toHaveBeenCalledWith({
          name: 'Relay',
          github_url: 'https://github.com/ac3charland/relay',
          key: 'RLP',
        });
      });
      // The new project appears in the combobox AND is auto-selected.
      const option = await screen.findByRole('option', { name: /relay/i });
      await waitFor(() => {
        expect(option).toHaveAttribute('aria-selected', 'true');
      });
    });
  });

  describe('New epic sub-dialog', () => {
    it('creates an epic via the store and auto-selects it', async () => {
      const newEpic: Epic = {
        ...EPIC,
        id: 'e2',
        name: 'Allow-list parser',
        ref: 'ALF-7',
        ref_number: 7,
      };
      mockCreateEpic.mockResolvedValue(newEpic);
      const user = userEvent.setup();
      renderGate();

      await user.click(await screen.findByRole('option', { name: /alfred/i }));
      await screen.findByRole('option', { name: /communication firewall/i });

      await user.click(screen.getByRole('button', { name: /new epic…/i }));
      const dialog = await screen.findByRole('dialog', { name: /new epic/i });
      await user.type(
        within(dialog).getByRole('textbox', { name: /epic name/i }),
        'Allow-list parser',
      );
      await user.click(within(dialog).getByRole('button', { name: /create epic/i }));

      await waitFor(() => {
        expect(mockCreateEpic).toHaveBeenCalledWith('p1', 'Allow-list parser');
      });
      const option = await screen.findByRole('option', { name: /allow-list parser/i });
      await waitFor(() => {
        expect(option).toHaveAttribute('aria-selected', 'true');
      });
      // Both selected now → Confirm is enabled.
      expect(screen.getByRole('button', { name: /send to code module/i })).toBeEnabled();
    });
  });
});
