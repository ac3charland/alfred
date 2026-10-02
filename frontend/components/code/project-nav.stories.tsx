import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeFactoryState, CodeStory, Project } from '@/lib/types';

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
  color: null,
  description: null,
  cloud_environment: null,
  exclude_from_pr_ratio: false,
  id: `pp${String(index + 1)}`,
  name: name ?? '',
  key: key ?? '',
  repo_owner: 'ac3charland',
  repo_name: repo ?? '',
  github_url: null,
  ref_seq: 0,
  created_at: `2025-02-0${String(index + 1)}T00:00:00Z`,
}));

/** A minimal story in `projectId` at `factoryState` — the only fields the sidebar reads. */
function makeStory(itemId: string, projectId: string, factoryState: CodeFactoryState): CodeStory {
  return {
    item_id: itemId,
    project_id: projectId,
    epic_id: `e-${projectId}`,
    ref_number: 1,
    ref: 'ALF-1',
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
    title: `Story ${itemId}`,
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: `Epic ${projectId}`,
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: 1,
  };
}

/** Seeds the code store with `stories` and frames the nav at its sidebar width. */
function withStories(stories: CodeStory[]): Decorator {
  return (Story) => (
    <CodeProvider initialProjects={PROJECTS} initialEpics={[]} initialStories={stories}>
      <div
        data-testid="projectnav-frame"
        className="w-64 border-r border-border bg-surface px-2 py-2"
      >
        <Story />
      </div>
    </CodeProvider>
  );
}

const meta = {
  title: 'Code/ProjectNav',
  component: ProjectNav,
  parameters: {
    layout: 'fullscreen',
    visualTest: { target: '[data-testid="projectnav-frame"]' },
  },
} satisfies Meta<typeof ProjectNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The Code sidebar: the two cross-project queues — Needs human action (the module's default view,
 * ALF-174) above the Backlog — plus the project list, each project carrying its assigned palette
 * colour on both the branch icon and the key pill, the same tinted-badge treatment as the Backlog
 * rows, so the two surfaces feel unified. Every project here has open work, so none is grayed out.
 */
export const Coloured: Story = {
  decorators: [
    withStories(
      PROJECTS.map((project) => makeStory(`s-${project.id}`, project.id, 'in_development')),
    ),
  ],
};

/**
 * A project with no active items — no stories, or only `done`/`abandoned` ones — is grayed out
 * (dimmed and desaturated) so the sidebar reads at a glance as "where the work is". Alfred and
 * Beacon hold open work (Beacon's only open story is blocked, which still counts) and keep their
 * colour; Relay (only done), Corral (no stories) and Drift (only abandoned) fade back.
 */
export const IdleProjectsGrayedOut: Story = {
  decorators: [
    withStories([
      makeStory('s1', 'pp1', 'in_development'),
      makeStory('s2', 'pp1', 'done'),
      makeStory('s3', 'pp2', 'done'),
      makeStory('s4', 'pp3', 'blocked'),
      makeStory('s5', 'pp5', 'abandoned'),
    ]),
  ],
};
