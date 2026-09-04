import { render, screen } from '@testing-library/react';

import { epicOptions, folderOptions, projectOptions } from '@/lib/tasks/label-options';
import type { Epic, Folder, Project } from '@/lib/types';

const WORK: Folder = {
  description: null,
  id: 'folder-1',
  name: 'Work',
  created_at: '2025-01-01T09:00:00Z',
  sort_order: 1,
};
const HOME: Folder = { ...WORK, id: 'folder-2', name: 'Home', sort_order: 2 };

const ALFRED: Project = {
  description: null,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 0,
  created_at: '2025-01-01T00:00:00Z',
};
const FORSCORE: Project = { ...ALFRED, id: 'p2', name: 'Forscore', key: 'FSC' };

const TRIAGE: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Inbox triage',
  notes: null,
  ref_number: 140,
  ref: 'ALF-140',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};

/** Render one option's label so the two-column nodes can be asserted as text. */
function renderLabel(label: React.ReactNode) {
  render(<>{label}</>);
}

describe('folderOptions', () => {
  it('lists the folders in the order given, with no clear entry by default', () => {
    expect(folderOptions([WORK, HOME])).toEqual([
      { value: 'folder-1', label: 'Work' },
      { value: 'folder-2', label: 'Home' },
    ]);
  });

  it('leads with the clear entry when one is named', () => {
    const options = folderOptions([WORK], 'No folder');

    expect(options[0]).toEqual({ value: null, label: 'No folder' });
    expect(options).toHaveLength(2);
  });
});

describe('projectOptions', () => {
  it('renders the name and the key, in that order', () => {
    const [option] = projectOptions([ALFRED]);
    renderLabel(option?.label);

    expect(option?.value).toBe('p1');
    expect(screen.getByText('Alfred')).toBeInTheDocument();
    expect(screen.getByText('ALF')).toBeInTheDocument();
  });

  it('keeps the input order and leads with the clear entry when one is named', () => {
    const options = projectOptions([ALFRED, FORSCORE], 'No project');

    expect(options.map((o) => o.value)).toEqual([null, 'p1', 'p2']);
    expect(options[0]?.label).toBe('No project');
  });
});

describe('epicOptions', () => {
  it('renders the name and the ref', () => {
    const [option] = epicOptions([TRIAGE]);
    renderLabel(option?.label);

    expect(option?.value).toBe('e1');
    expect(screen.getByText('Inbox triage')).toBeInTheDocument();
    expect(screen.getByText('ALF-140')).toBeInTheDocument();
  });

  it('renders no ref column for an epic that has none yet', () => {
    // An epic created before its first story numbered it carries an empty `ref`; an empty
    // second column would read as a missing value rather than an absent one.
    const [option] = epicOptions([{ ...TRIAGE, ref: '' }]);
    const { container } = render(<>{option?.label}</>);

    expect(screen.getByText('Inbox triage')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(1);
  });

  it('leads with the clear entry when one is named', () => {
    expect(epicOptions([TRIAGE], 'No epic')[0]).toEqual({ value: null, label: 'No epic' });
  });
});
