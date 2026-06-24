import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

import { ProjectNav } from './project-nav';

// One project per palette colour, in creation order, so the sidebar shows the full round-robin:
// the branch icon and the key pill read blue · amber · green · red · teal down the list.
const PROJECTS: Project[] = [
  ['Alfred', 'ALF', 'alfred'],
  ['Relay', 'RLP', 'relay'],
  ['Beacon', 'BCN', 'beacon'],
  ['Corral', 'COR', 'corral'],
  ['Drift', 'DRF', 'drift'],
].map(([name, key, repo], index) => ({
  id: `pp${String(index + 1)}`,
  name: name ?? '',
  key: key ?? '',
  repo_owner: 'ac3charland',
  repo_name: repo ?? '',
  github_url: null,
  ref_seq: 0,
  created_at: `2025-02-0${String(index + 1)}T00:00:00Z`,
}));

const meta = {
  title: 'Code/ProjectNav',
  component: ProjectNav,
  parameters: {
    layout: 'fullscreen',
    visualTest: { target: '[data-testid="projectnav-frame"]' },
  },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={PROJECTS} initialEpics={[]} initialStories={[]}>
        <div
          data-testid="projectnav-frame"
          className="w-64 border-r border-border bg-surface px-2 py-2"
        >
          <Story />
        </div>
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof ProjectNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The Code sidebar: a Backlog link plus the project list, each project carrying its assigned
 * palette colour on both the branch icon and the key pill — the same tinted-badge treatment as
 * the Backlog rows, so the two surfaces feel unified.
 */
export const Coloured: Story = {};
