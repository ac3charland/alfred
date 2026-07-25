import type { Meta, StoryObj } from '@storybook/nextjs';

import { CodeProvider } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

import { EpicGateDialog } from './epic-gate-dialog';

const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'p2',
    name: 'Relay',
    key: 'RLY',
    repo_owner: 'ac3charland',
    repo_name: 'relay',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-02T00:00:00Z',
  },
];

const meta = {
  title: 'Code/EpicGateDialog',
  component: EpicGateDialog,
  parameters: {
    layout: 'fullscreen',
    // The dialog renders in a Radix portal (outside #storybook-root), so target the dialog
    // content itself for the visual snapshot (per the storybook skill's portal note).
    visualTest: { target: '[role="dialog"]' },
  },
  // The gate reads the project list from the code store; seed it like the shell layout does.
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={PROJECTS} initialEpics={[]} initialStories={[]}>
        <Story />
      </CodeProvider>
    ),
  ],
  args: {
    open: true,
    onOpenChange: () => {},
    parent: { id: 'parent-1', title: 'Construction inbox', notes: null },
    childItems: [
      { id: 'c-1', title: 'Add plus button', notes: null, source_url: null },
      { id: 'c-2', title: 'Only allow 1-deep', notes: null, source_url: null },
      { id: 'c-3', title: 'Convert on send', notes: null, source_url: null },
    ],
    onComplete: () => {},
  },
} satisfies Meta<typeof EpicGateDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The epic gate open on a 3-story epic under construction: the project picker (no epic picker
 * — the epic is being created) and the read-only preview of the epic name plus its ordered
 * story titles. "Send to Code" stays disabled until a project is chosen.
 */
export const Open: Story = {};
