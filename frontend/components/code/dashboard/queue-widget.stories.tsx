import type { Meta, StoryObj } from '@storybook/nextjs';
import { ListOrdered, UserCheck } from 'lucide-react';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeStory, Project } from '@/lib/types';

import { QueueWidget } from './queue-widget';

const PROJECTS: Project[] = [
  {
    description: null,
    id: 'p1',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 220,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    description: null,
    id: 'p2',
    name: 'RealPlay',
    key: 'RP',
    repo_owner: 'ac3charland',
    repo_name: 'realplay',
    github_url: null,
    ref_seq: 44,
    created_at: '2025-01-02T00:00:00Z',
  },
];

function story(
  itemId: string,
  projectIndex: 0 | 1,
  ref: string,
  title: string,
  factoryState: CodeStory['factory_state'],
  priority: number,
): CodeStory {
  const project = PROJECTS[projectIndex];
  return {
    item_id: itemId,
    project_id: project?.id ?? 'p1',
    epic_id: null,
    ref_number: Number(ref.split('-', 2)[1]),
    ref,
    factory_state: factoryState,
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
    title,
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: project?.key ?? 'ALF',
    project_name: project?.name ?? 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: project?.repo_name ?? 'alfred',
    epic_name: null,
    epic_ref: null,
    epic_archived_at: null,
    epic_spec_path: null,
    priority,
  };
}

const QUEUE: CodeStory[] = [
  story('i1', 0, 'ALF-218', 'Create code dashboard for Alfred', 'in_refinement', 1),
  story('i2', 1, 'RP-44', 'Stage tuner drifts after a key change', 'ready_for_review', 2),
  story('i3', 0, 'ALF-212', 'Surface a broken Gmail account in the rail', 'ready_for_dev', 3),
  story('i4', 0, 'ALF-205', 'Forgive a bridged day in the habit streak', 'in_refinement', 4),
  story('i5', 1, 'RP-41', 'Export a setlist straight to forScore', 'ready_for_dev', 5),
  // Beyond the five drawn — present only so the header count can exceed the rows.
  story('i6', 0, 'ALF-220', 'Collapse the comms rail on a narrow window', 'blocked', 6),
  story('i7', 0, 'ALF-221', 'Retire the legacy capture endpoint', 'ready_for_dev', 7),
];

const meta = {
  title: 'Code/QueueWidget',
  component: QueueWidget,
  parameters: { visualTest: { target: '[data-testid="queue-widget-frame"]' } },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={PROJECTS} initialEpics={[]} initialStories={QUEUE}>
        <div data-testid="queue-widget-frame" className="w-[420px] bg-background p-4">
          <Story />
        </div>
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof QueueWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A populated pane: the queue's five top-ranked stories, each a project-tinted ref, a truncating
 * title and its factory-state chip. The header count is the WHOLE queue — seven here, five drawn —
 * so the pane says how much it is hiding.
 */
export const Populated: Story = {
  args: {
    title: 'Needs human action',
    icon: UserCheck,
    stories: QUEUE,
    href: '/code/needs-human-action',
    emptyMessage: 'Nothing needs your attention right now.',
  },
};

/** The empty queue still gets its pane — header, count and link — with a message in place of rows. */
export const Empty: Story = {
  args: {
    title: 'Backlog',
    icon: ListOrdered,
    stories: [],
    href: '/code/backlog',
    emptyMessage:
      'No stories yet. Send a story to the Code module from your inbox to start ranking your backlog.',
  },
};
