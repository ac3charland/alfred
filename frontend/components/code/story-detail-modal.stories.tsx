import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { StoryDetailModal } from './story-detail-modal';

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 12,
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
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};

const SPEC_MARKDOWN = `# Inbound filter spec

The inbound filter classifies each captured item before it reaches the board.

## Goals

- Parse the **allow-list** rules from \`.alfred/firewall.md\`.
- Reject anything not on the list, with a recorded reason.
- Emit a daily digest of what was filtered.

## Out of scope

1. The local-LLM review lane (Lane 1).
2. Per-sender rate limiting.
`;

const STORY: CodeStory = {
  item_id: 'i1',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 42,
  ref: 'ALF-42',
  factory_state: 'ready_for_dev',
  lane: 'human',
  spec_path: 'docs/specs/ALF-42.md',
  spec_sha: 'a1b2c3d4',
  spec_markdown: SPEC_MARKDOWN,
  refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/12',
  implementation_pr_url: null,
  blocked_reason: null,
  blocked_from: null,
  requires_refinement: true,
  code_created_at: '2025-01-01T00:00:00Z',
  code_updated_at: '2025-01-01T00:00:00Z',
  title: 'Draft the inbound filter spec',
  notes: 'The owner wants the firewall to default-deny and explain every rejection.',
  source_url: null,
  item_created_at: '2025-01-01T00:00:00Z',
  project_key: 'ALF',
  project_name: 'Alfred',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  epic_name: 'Communication Firewall',
  epic_ref: 'ALF-1',
  epic_archived_at: null,
  epic_spec_path: null,
  priority: 1,
};

/**
 * Backlog neighbours for {@link STORY} — one ranked above, one below — so the priority jumps
 * render live rather than uniformly disabled (a lone story already holds every slot).
 */
const NEIGHBOURS: CodeStory[] = [
  { ...STORY, item_id: 'i0', ref: 'ALF-41', title: 'Ship the digest', priority: 0 },
  { ...STORY, item_id: 'i2', ref: 'ALF-43', title: 'Rate-limit the sender', priority: 2 },
];

const meta = {
  title: 'Code/StoryDetailModal',
  component: StoryDetailModal,
  parameters: {
    layout: 'fullscreen',
    // The modal renders in a Radix portal (outside #storybook-root), so target the dialog
    // content itself for the visual snapshot (per the storybook skill's portal note).
    visualTest: { target: '[role="dialog"]' },
  },
  decorators: [
    (Story) => (
      <CodeProvider
        initialProjects={[PROJECT]}
        initialEpics={[EPIC]}
        initialStories={[STORY, ...NEIGHBOURS]}
      >
        <Story />
      </CodeProvider>
    ),
  ],
  args: {
    open: true,
    onOpenChange: () => {},
    onOpenSession: () => Promise.resolve(),
  },
} satisfies Meta<typeof StoryDetailModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A `ready_for_dev` story open in the modal: ref + inline-editable title, the Project › Epic
 * breadcrumb + state chip, notes, the rendered spec markdown (react-markdown + remark-gfm)
 * with the View-in-repo link, the refinement PR link, the Implement launch button, the four
 * Backlog priority jumps, and the manual fallback controls.
 */
export const ReadyForDev: Story = {
  args: { story: STORY },
};

/**
 * The priority jumps when the story already holds every slot — it leads and trails both its own
 * project and the whole Backlog, so all four buttons are disabled (there is nowhere to jump to).
 */
export const PriorityAtBothExtremes: Story = {
  args: { story: STORY },
  decorators: [
    (StoryComponent) => (
      <CodeProvider initialProjects={[PROJECT]} initialEpics={[EPIC]} initialStories={[STORY]}>
        <StoryComponent />
      </CodeProvider>
    ),
  ],
};

/**
 * The `ready_for_dev` story in the modal at a phone viewport (390×844): the dialog spans the
 * full phone width and its header actions, breadcrumb, notes, and rendered spec reflow for
 * mobile — the mobile counterpart of {@link ReadyForDev}.
 */
export const MobileReadyForDev: Story = {
  args: { story: STORY },
  parameters: {
    visualTest: { target: '[role="dialog"]', viewport: { width: 390, height: 844 } },
  },
};

/**
 * A story with no notes: the "Add notes…" affordance is shown in the Notes section.
 */
export const NoNotes: Story = {
  args: { story: { ...STORY, notes: null } },
};

/**
 * A `needs_refinement` story: the header shows BOTH launch buttons — the primary solid-accent
 * **Refine in Claude Code** and the subordinate outline **Skip to Development** (the bypass
 * flow). No spec has been written yet, so the spec body and PR links are absent.
 */
export const NeedsRefinement: Story = {
  args: {
    story: {
      ...STORY,
      factory_state: 'needs_refinement',
      ref: 'ALF-50',
      spec_path: null,
      spec_sha: null,
      spec_markdown: null,
      refinement_pr_url: null,
      title: 'Tweak the digest send time to 7am',
    },
  },
};

/**
 * A `ready_for_dev` story that never had a spec — where clearing the "Needs refinement" mark
 * parks a story, and where the Worker's revert of a closed-unmerged PR drops one. The mark reads
 * unchecked, the spec body and PR links are absent, and the launch is still **Implement in
 * Claude Code** (its prompt is the SKIP-REFINEMENT one, since no spec exists to read).
 */
export const ReadyForDevNoSpec: Story = {
  args: {
    story: {
      ...STORY,
      ref: 'ALF-51',
      requires_refinement: false,
      spec_path: null,
      spec_sha: null,
      spec_markdown: null,
      refinement_pr_url: null,
      title: 'Bump the wrangler compatibility date',
    },
  },
};
