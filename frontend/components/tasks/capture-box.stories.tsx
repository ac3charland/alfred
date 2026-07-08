import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

import { CaptureBox } from './capture-box';

const PROJECTS: Project[] = [
  {
    id: 'p-alf',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  },
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
