import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { screen, userEvent, within } from 'storybook/test';

import { CodeProvider } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

import { CaptureBox } from './capture-box';

function makeProject(id: string, name: string, key: string): Project {
  return {
    id,
    name,
    key,
    repo_owner: 'ac3charland',
    repo_name: name.toLowerCase(),
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  };
}

// Three projects so the suggestion list has something to rank — and so the positional colour
// palette (blue / amber / green) is visible across the rows.
const PROJECTS: Project[] = [
  makeProject('p-alf', 'Alfred', 'ALF'),
  makeProject('p-rlp', 'Relay', 'RLP'),
  makeProject('p-sbx', 'Sandbox', 'SBX'),
];

const meta = {
  title: 'Tasks/CaptureBox',
  component: CaptureBox,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
  // The capture box reads the project list from the code store (for prefix parsing); wrap it in a
  // seeded CodeProvider, mirroring the shell layout that hosts it around the Tasks view.
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={PROJECTS} initialEpics={[]} initialStories={[]}>
        <Story />
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof CaptureBox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The Inbox capture box: a `<project>:` prefix (e.g. `ALF: ship dark mode`) classifies as Code. */
export const WithProjectPrefixParsing: Story = {
  args: {
    parseProjectPrefix: true,
  },
};

/**
 * The suggestion list, opened by typing a leading `:`. Every project is offered in nav order with
 * the first row active; selecting one writes `<KEY>: ` into the box.
 */
export const ProjectSuggestionsOpen: Story = {
  args: {
    parseProjectPrefix: true,
  },
  parameters: {
    // The panel is portaled out of #storybook-root, so a root-tight crop would photograph an
    // empty box. Capture the whole page instead.
    visualTest: { target: 'body' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox', { name: 'Capture box' }), ':');
    await screen.findByRole('listbox', { name: 'Projects' });
  },
};

export const WithFolder: Story = {
  args: {
    folderId: 'folder-123',
  },
};

export const Compact: Story = {
  args: {
    compact: true,
  },
};

export const CompactWithParent: Story = {
  args: {
    compact: true,
    parentId: 'parent-task-1',
  },
};
