import { render, screen } from '@testing-library/react';
import * as React from 'react';

import type { ItemNode } from '@/lib/tree';
import type { Folder } from '@/lib/types';

import { InboxScreen } from './inbox-screen';

// Mock next/link as a plain anchor so we can assert on hrefs.
jest.mock(
  'next/link',
  () =>
    function MockLink({ href, children, ...rest }: { href: string; children: React.ReactNode }) {
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    },
);

// Stub the children — they are exercised by their own tests. Here we only care
// about the screen's own toggle + reveal logic.
jest.mock('./capture-box', () => ({
  CaptureBox: function MockCaptureBox() {
    return <div data-testid="capture-box" />;
  },
}));

jest.mock('./task-list', () => ({
  TaskList: function MockTaskList({ emptyMessage }: { emptyMessage?: string }) {
    return <div data-testid="task-list">{emptyMessage}</div>;
  },
}));

const NODES: ItemNode[] = [];
const FOLDERS: Folder[] = [];

describe('InboxScreen', () => {
  it('shows only the capture box and a subtle "View inbox" link on the landing screen', () => {
    render(<InboxScreen open={false} nodes={NODES} folders={FOLDERS} />);

    expect(screen.getByTestId('capture-box')).toBeInTheDocument();

    const viewLink = screen.getByRole('link', { name: /view inbox/i });
    expect(viewLink).toHaveAttribute('href', '/?view=inbox');

    // The inbox list is not revealed on the bare landing screen.
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /close inbox/i })).not.toBeInTheDocument();
  });

  it('reveals the inbox list and a Close link when open', () => {
    render(<InboxScreen open nodes={NODES} folders={FOLDERS} />);

    expect(screen.getByTestId('capture-box')).toBeInTheDocument();
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    const closeLink = screen.getByRole('link', { name: /close inbox/i });
    expect(closeLink).toHaveAttribute('href', '/');

    expect(screen.queryByRole('link', { name: /view inbox/i })).not.toBeInTheDocument();
  });
});
