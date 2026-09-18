import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { readerFixtureSet } from '@/lib/reader/fixtures';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderPost } from '@/lib/types';

import { ReadingListView } from './reading-list-view';

/**
 * The reading list itself: populated with every Story-1 row state at once (the fixture set), and
 * the resting empty state.
 */

function withoutText({ text: _text, ...listItem }: ReaderPost) {
  return listItem;
}

const withFrame: Decorator = (Story) => (
  <div data-testid="list-frame" className="w-[720px] bg-background p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Reader/ReadingListView',
  component: ReadingListView,
  decorators: [withFrame],
} satisfies Meta<typeof ReadingListView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every Story-1 row state at once — the demo doc's populated screenshot. */
export const Populated: Story = {
  decorators: [
    (Story) => {
      const { posts } = readerFixtureSet();
      return (
        <ToastProvider>
          <ReaderProvider initialPosts={posts.map((post) => withoutText(post))}>
            <Story />
          </ReaderProvider>
        </ToastProvider>
      );
    },
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
};

/** Nothing to read — the resting empty state. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderProvider initialPosts={[]}>
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
};
