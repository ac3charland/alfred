import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { Backlog } from './backlog';

const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 12,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'p2',
    name: 'Relay',
    key: 'RLP',
    repo_owner: 'ac3charland',
    repo_name: 'relay',
    github_url: null,
    ref_seq: 4,
    created_at: '2025-01-02T00:00:00Z',
  },
];

const EPICS: Epic[] = [
  {
    id: 'e1',
    project_id: 'p1',
    name: 'Communication Firewall',
    notes: null,
    ref_number: 1,
    ref: 'ALF-1',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'e2',
    project_id: 'p2',
    name: 'Newsletter Reader',
    notes: null,
    ref_number: 1,
    ref: 'RLP-1',
    archived_at: null,
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
  const epic = EPICS[projectIndex];
  return {
    item_id: itemId,
    project_id: project?.id ?? 'p1',
    epic_id: epic?.id ?? 'e1',
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
    epic_name: epic?.name ?? 'Epic',
    epic_ref: epic?.ref ?? 'ALF-1',
    epic_archived_at: null,
    priority,
  };
}

// A cross-project, mixed-state backlog ranked by priority (lower = higher).
const STORIES: CodeStory[] = [
  story('i1', 0, 'ALF-3', 'Draft the spec for the inbound filter', 'needs_refinement', 1),
  story('i2', 1, 'RLP-2', 'Extract novel insights from a newsletter', 'in_refinement', 2),
  story('i3', 0, 'ALF-5', 'Implement the allow-list parser', 'in_development', 3),
  story('i4', 1, 'RLP-3', 'Build the digest summary layer', 'ready_for_dev', 4),
  story('i5', 0, 'ALF-6', 'Verify the webhook HMAC signature', 'blocked', 5),
  story('i6', 0, 'ALF-7', 'Add the ranked triage UI', 'ready_for_review', 6),
];

const meta = {
  title: 'Code/Backlog',
  component: Backlog,
  parameters: {
    layout: 'fullscreen',
    visualTest: { target: '[data-testid="backlog-frame"]' },
  },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={PROJECTS} initialEpics={EPICS} initialStories={STORIES}>
        <div data-testid="backlog-frame" className="w-[900px] bg-background">
          <Story />
        </div>
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof Backlog>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The cross-project Backlog: every outstanding story ranked by global priority, each row with
 * its ref, title, project + epic badges, a full-state status chip, and the up/down chevrons. The
 * first row's Up and the last row's Down are disabled (the ends of the order).
 */
export const Seeded: Story = {};
