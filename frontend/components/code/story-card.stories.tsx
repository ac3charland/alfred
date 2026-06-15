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
};

const meta = {
  title: 'Code/StoryCard',
  component: StoryCard,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { story: BASE_STORY },
} satisfies Meta<typeof StoryCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A happy-path story card: ref + title, the default board treatment. */
export const Default: Story = {};

/** A blocked story: amber edge + a Blocked tag, surfaced via the board's filter toggle. */
export const Blocked: Story = {
  args: { story: { ...BASE_STORY, factory_state: 'blocked', ref: 'ALF-43' } },
};

/** An abandoned story: a red edge + an Abandoned tag. */
export const Abandoned: Story = {
  args: { story: { ...BASE_STORY, factory_state: 'abandoned', ref: 'ALF-44' } },
};
