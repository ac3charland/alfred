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

// Five projects — one per palette colour — to show the full round-robin (blue, amber, green, red,
// teal) on the Backlog badges. `[name, key, repo, state, title]`, in creation order.
const PALETTE_SEED: [string, string, string, CodeStory['factory_state'], string][] = [
  ['Alfred', 'ALF', 'alfred', 'needs_refinement', 'Draft the inbound-filter spec'],
  ['Relay', 'RLP', 'relay', 'in_refinement', 'Extract novel newsletter insights'],
  ['Beacon', 'BCN', 'beacon', 'ready_for_dev', 'Wire the alerting webhook'],
  ['Corral', 'COR', 'corral', 'in_development', 'Build the weekly roundup view'],
  ['Drift', 'DRF', 'drift', 'ready_for_review', 'Tune the ranking model'],
];

const PALETTE = PALETTE_SEED.map(([name, key, repo, factoryState, title], index) => {
  const createdAt = `2025-02-0${String(index + 1)}T00:00:00Z`;
  const project: Project = {
    id: `pp${String(index + 1)}`,
    name,
    key,
    repo_owner: 'ac3charland',
    repo_name: repo,
    github_url: null,
    ref_seq: 0,
    created_at: createdAt,
  };
  const epic: Epic = {
    id: `pe${String(index + 1)}`,
    project_id: project.id,
    name: `${name} epic`,
    notes: null,
    ref_number: 1,
    ref: `${key}-1`,
    archived_at: null,
    created_at: createdAt,
  };
  const codeStory: CodeStory = {
    item_id: `ps${String(index + 1)}`,
    project_id: project.id,
    epic_id: epic.id,
    ref_number: index + 2,
    ref: `${key}-${String(index + 2)}`,
    factory_state: factoryState,
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: createdAt,
    code_updated_at: createdAt,
    title,
    notes: null,
    source_url: null,
    item_created_at: createdAt,
    project_key: key,
    project_name: name,
    repo_owner: 'ac3charland',
    repo_name: repo,
    epic_name: epic.name,
    epic_ref: epic.ref,
    epic_archived_at: null,
    priority: index + 1,
  };
  return { project, epic, codeStory };
});

const PALETTE_PROJECTS = PALETTE.map((row) => row.project);
const PALETTE_EPICS = PALETTE.map((row) => row.epic);
const PALETTE_STORIES = PALETTE.map((row) => row.codeStory);

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

/**
 * One project per palette colour, so the full round-robin shows at once: the badges read
 * **blue · amber · green · red · teal** down the list (project creation order). A nested
 * `CodeProvider` re-seeds this story with the five-project dataset.
 */
export const AllProjectColours: Story = {
  decorators: [
    (Story) => (
      <CodeProvider
        initialProjects={PALETTE_PROJECTS}
        initialEpics={PALETTE_EPICS}
        initialStories={PALETTE_STORIES}
      >
        <Story />
      </CodeProvider>
    ),
  ],
};

/**
 * The ALF-86 mobile backlog: at a phone width each row gives its ref + full title its own line
 * (no more "Disabl…" truncation), drops the project / epic / status badges into a footer below,
 * and enlarges the reorder chevrons to ≥44px tap targets. Rendered in a phone-width frame at a
 * mobile viewport so the `md:`-gated restructure takes effect; the crop targets that frame.
 */
export const MobileRows: Story = {
  decorators: [
    (Story) => (
      <div data-testid="backlog-mobile-frame" className="w-[390px] bg-background">
        <Story />
      </div>
    ),
  ],
  parameters: {
    visualTest: {
      target: '[data-testid="backlog-mobile-frame"]',
      viewport: { width: 390, height: 844 },
    },
  },
};
