import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { useBucketName } from './use-bucket-name';

const WORK: Folder = {
  id: 'work',
  name: 'Work',
  created_at: '2026-01-01T00:00:00Z',
  sort_order: 1,
  description: null,
};

/** Only the residency columns matter to the label. */
function task(folderId: string | null, dispatchedAt: string | null): Item {
  return { folder_id: folderId, dispatched_at: dispatchedAt } as Item;
}

function Probe({ item }: { item: Item }) {
  const bucketName = useBucketName();
  return <p>{bucketName(item)}</p>;
}

describe('useBucketName', () => {
  it('names the folder a filed task resides in', () => {
    renderWithProviders(<Probe item={task('work', '2026-01-01T00:00:00Z')} />, {
      folders: [WORK],
    });

    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('reads Inbox for a task with no folder', () => {
    renderWithProviders(<Probe item={task(null, null)} />, { folders: [WORK] });

    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('reads Inbox for a task that carries a folder but is still awaiting triage', () => {
    renderWithProviders(<Probe item={task('work', null)} />, { folders: [WORK] });

    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('falls back to Unknown when the folder is not in the store', () => {
    renderWithProviders(<Probe item={task('gone', '2026-01-01T00:00:00Z')} />, {
      folders: [WORK],
    });

    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
