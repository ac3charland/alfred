import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { NeedsHumanAction } from './needs-human-action';

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

// A cross-project queue of stories awaiting a human — one per human-review state, plus a couple of
// non-review states that the view filters out (so the story doubles as a filter check).
const STORIES: CodeStory[] = [
  story('i1', 0, 'ALF-3', 'Review the inbound-filter spec', 'in_refinement', 1),
  story('i2', 1, 'RLP-2', 'Approve the digest summary spec', 'in_refinement', 2),
  story('i3', 0, 'ALF-5', 'Clear the allow-list parser for dev', 'ready_for_dev', 3),
  story('i4', 1, 'RLP-3', 'Clear the ranking model for dev', 'ready_for_dev', 4),
  story('i5', 0, 'ALF-6', 'Review the webhook HMAC PR', 'ready_for_review', 5),
  // Filtered out — not a human-review state.
  story('i6', 0, 'ALF-7', 'Draft the triage UI spec', 'needs_refinement', 6),
  story('i7', 0, 'ALF-8', 'Wire the alert dispatcher', 'in_development', 7),
];

const meta = {
  title: 'Code/NeedsHumanAction',
  component: NeedsHumanAction,
  parameters: {
    layout: 'fullscreen',
    visualTest: { target: '[data-testid="needs-human-action-frame"]' },
  },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={PROJECTS} initialEpics={EPICS} initialStories={STORIES}>
        <div data-testid="needs-human-action-frame" className="w-[900px] bg-background">
          <Story />
        </div>
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof NeedsHumanAction>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The cross-project "Needs human action" queue: every story in a human-review state
 * (In Refinement / Ready for Dev / Ready for Review) ranked by global priority, each row with the
 * same reorder chevrons as the Backlog. The `needs_refinement` and `in_development` stories in the
 * seed are filtered out — only the states that need a human show.
 */
export const Seeded: Story = {};
