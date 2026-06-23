import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';
import type { BoardLane } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

import { Swimlane } from './swimlane';

function makeStory(itemId: string, ref: string, title: string): CodeStory {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref,
    factory_state: 'in_development',
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
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Communication Firewall',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    priority: 1,
  };
}

const FILLED: BoardLane = {
  state: 'in_development',
  label: 'In Development',
  stories: [
    makeStory('i1', 'ALF-42', 'Verify the GitHub webhook HMAC signature'),
    makeStory('i2', 'ALF-45', 'Snapshot the merged spec markdown'),
  ],
};

const meta = {
  title: 'Code/Swimlane',
  component: Swimlane,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof Swimlane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A lane with two story cards and its live count. */
export const Filled: Story = {
  args: { lane: FILLED },
};

/** An empty lane: the count reads 0 and a faint placeholder shows. */
export const Empty: Story = {
  args: { lane: { state: 'done', label: 'Done', stories: [] } },
};
