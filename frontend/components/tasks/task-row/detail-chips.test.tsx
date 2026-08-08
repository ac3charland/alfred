import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecurrenceRule } from '@/lib/recurrence';
import { renderWithProviders } from '@/lib/test-utils';
import type { Epic, Folder, Project } from '@/lib/types';

import { FolderChip, IntendedEpicChip, IntendedProjectChip, RepeatChip } from './detail-chips';

// ── Seed builders for the store-reading chips (Folder / Project / Epic). ──

const FOLDERS: Folder[] = [
  {
    description: null,
    id: 'f1',
    name: 'Health',
    created_at: '2025-01-01T10:00:00Z',
    sort_order: 1,
  },
  { description: null, id: 'f2', name: 'Work', created_at: '2025-01-01T11:00:00Z', sort_order: 2 },
];

function project(id: string, name: string, key: string): Project {
  return {
    description: null,
    id,
    name,
    key,
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T10:00:00Z',
  };
}

function epic(id: string, projectId: string, name: string, ref: string): Epic {
  return {
    id,
    project_id: projectId,
    name,
    notes: null,
    ref_number: 1,
    ref,
    archived_at: null,
    created_at: '2025-01-01T10:00:00Z',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
  };
}

const PROJECTS = [project('p1', 'Alfred', 'ALF'), project('p2', 'Realplay', 'RPL')];
const EPICS = [
  epic('e1', 'p1', 'Inbox triage', 'ALF-104'),
  epic('e2', 'p1', 'LLM processing', 'ALF-158'),
  epic('e3', 'p2', 'Other project epic', 'RPL-3'),
];

describe('detail chips (ALF-67)', () => {
  describe('RepeatChip', () => {
    const dailyRule: RecurrenceRule = { freq: 'daily', interval: 1, end: { type: 'never' } };

    it('shows "Never" when not repeating and the summary when it does', () => {
      const { rerender } = render(<RepeatChip rule={null} dueDate={null} onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent('Never');
      rerender(<RepeatChip rule={dailyRule} dueDate="2025-07-02" onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent(/daily/i);
    });

    it('applies a preset, anchored to the due date', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();
      // A known anchor (the due date) makes the produced rule deterministic.
      render(<RepeatChip rule={null} dueDate="2025-07-02" onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Repeat' }));
      await user.click(await screen.findByRole('button', { name: 'Daily' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ freq: 'daily' }),
        '2025-07-02',
      );
    });

    it('opens the full custom editor from "Custom…"', async () => {
      const user = userEvent.setup();
      render(<RepeatChip rule={null} dueDate="2025-07-02" onChange={jest.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Repeat' }));
      await user.click(await screen.findByRole('button', { name: /custom/i }));

      // The RecurrenceEditor dialog opens (it carries a "Repeat every" control).
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });
});

describe('the label chips (ALF-170)', () => {
  describe('FolderChip', () => {
    it('shows the folder name teal when set, "No folder" neutral when not', () => {
      const { rerender } = renderWithProviders(
        <FolderChip folderId="f1" allowClear onSelect={jest.fn()} />,
        { folders: FOLDERS },
      );
      expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('Health');
      rerender(<FolderChip folderId={null} allowClear onSelect={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('No folder');
    });

    it('lists every folder, ticks the current one, and auto-saves a pick', async () => {
      const onSelect = jest.fn();
      const user = userEvent.setup();
      renderWithProviders(<FolderChip folderId="f1" allowClear onSelect={onSelect} />, {
        folders: FOLDERS,
      });

      await user.click(screen.getByRole('button', { name: 'Folder' }));
      await user.click(await screen.findByRole('button', { name: 'Work' }));

      expect(onSelect).toHaveBeenCalledWith('f2');
    });

    it('offers "No folder" only while the row is undispatched (allowClear)', async () => {
      const user = userEvent.setup();
      const { unmount } = renderWithProviders(
        <FolderChip folderId="f1" allowClear onSelect={jest.fn()} />,
        { folders: FOLDERS },
      );
      await user.click(screen.getByRole('button', { name: 'Folder' }));
      expect(await screen.findByRole('button', { name: 'No folder' })).toBeInTheDocument();
      unmount();

      renderWithProviders(<FolderChip folderId="f1" allowClear={false} onSelect={jest.fn()} />, {
        folders: FOLDERS,
      });
      await user.click(screen.getByRole('button', { name: 'Folder' }));
      await screen.findByRole('button', { name: 'Work' });
      expect(screen.queryByRole('button', { name: 'No folder' })).not.toBeInTheDocument();
    });

    it('compact: renders the row pill only when a folder is set, and inert as a span', () => {
      const { rerender } = renderWithProviders(
        <FolderChip folderId={null} allowClear size="compact" onSelect={jest.fn()} />,
        { folders: FOLDERS },
      );
      expect(screen.queryByText('Health')).not.toBeInTheDocument();

      rerender(<FolderChip folderId="f1" allowClear size="compact" onSelect={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Folder: Health' })).toBeInTheDocument();

      rerender(<FolderChip folderId="f1" allowClear size="compact" inert onSelect={jest.fn()} />);
      expect(screen.getByText('Health')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('IntendedProjectChip', () => {
    it('shows the project name when set and "No project" when not', () => {
      const { rerender } = renderWithProviders(
        <IntendedProjectChip projectId="p1" onSelect={jest.fn()} />,
        { projects: PROJECTS },
      );
      expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Alfred');
      rerender(<IntendedProjectChip projectId={null} onSelect={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('No project');
    });

    it('lists every project plus "No project" and auto-saves a pick', async () => {
      const onSelect = jest.fn();
      const user = userEvent.setup();
      renderWithProviders(<IntendedProjectChip projectId="p1" onSelect={onSelect} />, {
        projects: PROJECTS,
      });

      await user.click(screen.getByRole('button', { name: 'Project' }));
      await user.click(await screen.findByRole('button', { name: /Realplay/ }));
      expect(onSelect).toHaveBeenCalledWith('p2');

      await user.click(screen.getByRole('button', { name: 'Project' }));
      await user.click(await screen.findByRole('button', { name: 'No project' }));
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  describe('IntendedEpicChip', () => {
    it('is disabled with a hint while no project is set', () => {
      renderWithProviders(
        <IntendedEpicChip projectId={null} epicId={null} onSelect={jest.fn()} />,
        { projects: PROJECTS, epics: EPICS },
      );
      const chip = screen.getByRole('button', { name: 'Epic' });
      expect(chip).toBeDisabled();
      expect(chip).toHaveAttribute('title', 'Pick a project first');
    });

    it("lists only the selected project's epics, plus 'No epic'", async () => {
      const user = userEvent.setup();
      renderWithProviders(<IntendedEpicChip projectId="p1" epicId={null} onSelect={jest.fn()} />, {
        projects: PROJECTS,
        epics: EPICS,
      });

      await user.click(screen.getByRole('button', { name: 'Epic' }));
      expect(await screen.findByRole('button', { name: /Inbox triage/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /LLM processing/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'No epic' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Other project epic/ })).not.toBeInTheDocument();
    });

    it('shows the ref + name when set and auto-saves a pick', async () => {
      const onSelect = jest.fn();
      const user = userEvent.setup();
      renderWithProviders(<IntendedEpicChip projectId="p1" epicId="e1" onSelect={onSelect} />, {
        projects: PROJECTS,
        epics: EPICS,
      });

      const chip = screen.getByRole('button', { name: 'Epic' });
      expect(chip).toHaveTextContent('ALF-104');
      expect(chip).toHaveTextContent('Inbox triage');

      await user.click(chip);
      await user.click(await screen.findByRole('button', { name: /LLM processing/ }));
      expect(onSelect).toHaveBeenCalledWith('e2');
    });

    it('compact: renders the ref-only pill when set, and inert as a span', () => {
      const { rerender } = renderWithProviders(
        <IntendedEpicChip projectId="p1" epicId={null} size="compact" onSelect={jest.fn()} />,
        { projects: PROJECTS, epics: EPICS },
      );
      expect(screen.queryByText('ALF-104')).not.toBeInTheDocument();

      rerender(<IntendedEpicChip projectId="p1" epicId="e1" size="compact" onSelect={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Epic: ALF-104' })).toBeInTheDocument();

      rerender(
        <IntendedEpicChip projectId="p1" epicId="e1" size="compact" inert onSelect={jest.fn()} />,
      );
      expect(screen.getByText('ALF-104')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
