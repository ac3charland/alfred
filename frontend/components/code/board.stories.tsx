import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import { Board } from './board';

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
    project_id: 'p1',
    name: 'Capture Pipeline',
    notes: null,
    ref_number: 2,
    ref: 'ALF-2',
    archived_at: null,
    created_at: '2025-01-02T00:00:00Z',
  },
];

function story(
  itemId: string,
  epicId: string,
  ref: string,
  title: string,
  factoryState: CodeStory['factory_state'],
): CodeStory {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: epicId,
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
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: epicId === 'e1' ? 'Communication Firewall' : 'Capture Pipeline',
    epic_ref: epicId === 'e1' ? 'ALF-1' : 'ALF-2',
    epic_archived_at: null,
  };
}

const STORIES: CodeStory[] = [
  story('i1', 'e1', 'ALF-3', 'Draft the spec for the inbound filter', 'needs_refinement'),
  story('i2', 'e1', 'ALF-4', 'Refine the routing rules', 'in_refinement'),
  story('i3', 'e1', 'ALF-5', 'Implement the allow-list parser', 'in_development'),
  story('i4', 'e1', 'ALF-6', 'Add the digest summary', 'done'),
  story('i5', 'e2', 'ALF-7', 'Capture box keyboard focus', 'ready_for_dev'),
  story('i6', 'e2', 'ALF-8', 'Voice capture endpoint', 'ready_for_review'),
];

const meta = {
  title: 'Code/Board',
  component: Board,
  parameters: {
    layout: 'fullscreen',
    // The board is wide; capture a fixed-width frame so the snapshot is deterministic.
    visualTest: { target: '[data-testid="board-frame"]' },
  },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={[PROJECT]} initialEpics={EPICS} initialStories={STORIES}>
        <div data-testid="board-frame" className="w-[1100px] bg-background">
          <Story />
        </div>
      </CodeProvider>
    ),
  ],
  args: { projectId: 'p1' },
} satisfies Meta<typeof Board>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A seeded project board: two epics, each expanded into its six happy-path swimlanes. */
export const Seeded: Story = {};

// ── Realtime swimlane move (ALF-41) ─────────────────────────────────────────────
// One epic with a single story sitting in "In Refinement". The Worker (a non-browser
// writer) advances it to "Ready for Dev"; the open board reflects that live with no reload.
const REALTIME_EPIC: Epic[] = EPICS.slice(0, 1);
const REALTIME_STORY: CodeStory[] = [
  story('i9', 'e1', 'ALF-41', 'Realtime swimlane updates', 'in_refinement'),
];

/** The out-of-band `code_items` UPDATE the Worker writes (the "second writer"). */
const MOVED_SIDECAR: CodeItem = {
  item_id: 'i9',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 41,
  ref: 'ALF-41',
  factory_state: 'ready_for_dev',
  lane: 'human',
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  implementation_pr_url: null,
  blocked_reason: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-06-22T00:00:00Z',
};

/**
 * Fire the simulated Worker write once mounted. Deferred a tick so it lands AFTER the
 * CodeProvider's subscription effect has registered its handler (the Storybook supabase
 * mock routes `emitCodeItemsUpdate` to it).
 */
function EmitWorkerMove() {
  React.useEffect(() => {
    const id = setTimeout(() => {
      (globalThis as { emitCodeItemsUpdate?: (row: CodeItem) => void }).emitCodeItemsUpdate?.(
        MOVED_SIDECAR,
      );
    }, 50);
    return () => {
      clearTimeout(id);
    };
  }, []);
  return null;
}

function realtimeDecorator(emit: boolean) {
  return function Decorator(StoryComponent: React.ComponentType) {
    return (
      <CodeProvider
        initialProjects={[PROJECT]}
        initialEpics={REALTIME_EPIC}
        initialStories={REALTIME_STORY}
      >
        <div data-testid="board-frame" className="w-[1100px] bg-background">
          <StoryComponent />
        </div>
        {emit ? <EmitWorkerMove /> : null}
      </CodeProvider>
    );
  };
}

/** Before: ALF-41 sits in the "In Refinement" swimlane. */
export const RealtimeMoveBefore: Story = {
  parameters: { visualTest: null },
  decorators: [realtimeDecorator(false)],
};

/** After: an out-of-band `code_items` UPDATE moved ALF-41 to "Ready for Dev" — no reload. */
export const RealtimeMoveAfter: Story = {
  parameters: { visualTest: null },
  decorators: [realtimeDecorator(true)],
};

/** Board with one archived epic — the "Show archived" toggle reveals it. */
export const WithArchivedEpic: Story = {
  decorators: [
    (Story) => {
      const epics = EPICS.map((epic) =>
        epic.id === 'e2' ? { ...epic, archived_at: '2026-01-15T00:00:00Z' } : epic,
      );
      return (
        <CodeProvider initialProjects={[PROJECT]} initialEpics={epics} initialStories={STORIES}>
          <div data-testid="board-frame" className="w-[1100px] bg-background">
            <Story />
          </div>
        </CodeProvider>
      );
    },
  ],
};
