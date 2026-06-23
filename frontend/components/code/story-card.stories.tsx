import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';
import type { CodeStory } from '@/lib/types';

import { StoryCard } from './story-card';

const BASE_STORY: CodeStory = {
  item_id: 'i1',
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
  code_created_at: '2025-01-01T00:00:00Z',
  code_updated_at: '2025-01-01T00:00:00Z',
  title: 'Verify the GitHub webhook HMAC signature',
  notes: null,
  source_url: null,
  item_created_at: '2025-01-01T00:00:00Z',
  project_key: 'ALF',
  project_name: 'Alfred',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  epic_name: 'Communication Firewall',
  epic_ref: 'ALF-1',
  epic_archived_at: null,
  priority: 1,
};

const meta = {
  title: 'Code/StoryCard',
  component: StoryCard,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  // A no-op launch handler so the launch button renders and is clickable in the gallery.
  args: { story: BASE_STORY, onOpenSession: () => {} },
} satisfies Meta<typeof StoryCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A `needs_refinement` story: ref + title + the phase-appropriate **Refine in Claude Code**
 * launch button. This is the default board treatment for a freshly-gated story.
 */
export const Default: Story = {};

/**
 * A `ready_for_dev` story (its refinement PR merged): the launch button switches to
 * **Implement in Claude Code**.
 */
export const ReadyForDev: Story = {
  args: { story: { ...BASE_STORY, factory_state: 'ready_for_dev', ref: 'ALF-45' } },
};

/**
 * An `in_refinement` story: a Claude Code session is already running, so NO launch button
 * applies — the card is just ref + title until the webhook advances it.
 */
export const InRefinement: Story = {
  args: { story: { ...BASE_STORY, factory_state: 'in_refinement', ref: 'ALF-46' } },
};

/** A blocked story: amber edge + a Blocked tag, surfaced via the board's filter toggle. */
export const Blocked: Story = {
  args: { story: { ...BASE_STORY, factory_state: 'blocked', ref: 'ALF-43' } },
};

/** An abandoned story: a red edge + an Abandoned tag. */
export const Abandoned: Story = {
  args: { story: { ...BASE_STORY, factory_state: 'abandoned', ref: 'ALF-44' } },
};
