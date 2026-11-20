import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderPost } from '@/lib/reader/fixtures';
import { useTasks } from '@/lib/stores/tasks-store';
import type { Item, ReaderPostListItem } from '@/lib/types';

import { ReaderInboxCapture } from './inbox-capture';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client', () => ({
  ...jest.createMockFromModule<typeof import('@/lib/api-client')>('@/lib/api-client'),
  ApiError: jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client').ApiError,
}));
const mockApi = jest.mocked(api);

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const URL = 'https://importai.substack.com/p/import-ai-412';

function post(overrides: Partial<Omit<ReaderPostListItem, 'overview'>> = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...listItem
  } = makeReaderPost(PUBLICATION_ID, {
    title: 'Import AI 412: the eval that wouldn’t transfer',
    author: 'Import AI',
    canonical_url: URL,
    ...overrides,
  });
  return listItem;
}

/** What the server answers a create with: the row it was sent, under a real id. */
function echoCreate(): void {
  mockApi.createItem.mockImplementation((input) =>
    Promise.resolve({ ...input, id: `server-${input.title ?? 'item'}` } as unknown as Item),
  );
}

/** The Tasks store's titles — what the Inbox reads. */
function TaskTitles() {
  const tasks = useTasks();
  return (
    <ul aria-label="tasks">
      {tasks.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  );
}

function renderCapture(row: ReaderPostListItem = post(), onClose: () => void = jest.fn()) {
  return renderReader(
    <>
      <ReaderInboxCapture post={row} onClose={onClose} />
      <TaskTitles />
    </>,
    [row],
  );
}

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: 'New Inbox item' });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ReaderInboxCapture', () => {
  it('takes focus as it opens', () => {
    renderCapture();
    expect(field()).toHaveFocus();
  });

  it('holds Add while the text is blank or only whitespace, and Enter creates nothing', async () => {
    const user = userEvent.setup();
    renderCapture();

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.type(field(), '   {Enter}');

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(mockApi.createItem).not.toHaveBeenCalled();
  });

  it('adds the trimmed text as an unclassified item linked back to the post', async () => {
    echoCreate();
    const user = userEvent.setup();
    renderCapture();

    await user.type(field(), '  Ask Ana about sim-to-real  {Enter}');

    expect(mockApi.createItem).toHaveBeenCalledTimes(1);
    expect(mockApi.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Ask Ana about sim-to-real',
        raw_capture: 'Ask Ana about sim-to-real',
        title: 'Ask Ana about sim-to-real',
        item_type: 'unclassified',
        source_url: URL,
        notes: `From the Reader: “Import AI 412: the eval that wouldn’t transfer” — Import AI\n${URL}`,
      }),
    );
  });

  it('sends no source_url and a one-line note for a post with nowhere to link', async () => {
    echoCreate();
    const user = userEvent.setup();
    renderCapture(post({ canonical_url: null, rfc822_message_id: null }));

    await user.type(field(), 'Follow up{Enter}');

    const sent = mockApi.createItem.mock.calls[0]?.[0];
    expect(sent).not.toHaveProperty('source_url');
    expect(sent?.notes).toBe(
      'From the Reader: “Import AI 412: the eval that wouldn’t transfer” — Import AI',
    );
  });

  it('clears and keeps focus for the next one, and the item lands in the Tasks store', async () => {
    echoCreate();
    const user = userEvent.setup();
    renderCapture();

    await user.type(field(), 'First{Enter}');

    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(await screen.findByText('First', { selector: 'li' })).toBeInTheDocument();
  });

  it('adds by the Add button too', async () => {
    echoCreate();
    const user = userEvent.setup();
    renderCapture();

    await user.type(field(), 'By click');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(mockApi.createItem).toHaveBeenCalledWith(expect.objectContaining({ title: 'By click' }));
  });

  it('confirms a landed add with one toast whose text links to the Inbox', async () => {
    echoCreate();
    const user = userEvent.setup();
    renderCapture();

    await user.type(field(), 'Linked{Enter}');

    // The Inbox list itself, not the bare capture landing at `/` where the list is hidden.
    expect(await screen.findByRole('link', { name: 'Added to Inbox' })).toHaveAttribute(
      'href',
      '/?view=inbox',
    );
    expect(screen.getAllByText('Added to Inbox')).toHaveLength(1);
  });

  it('puts the text back on a failed add, with only the failure toast', async () => {
    mockApi.createItem.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderCapture();

    await user.type(field(), 'Lost?{Enter}');

    await waitFor(() => {
      expect(field()).toHaveValue('Lost?');
    });
    expect(await screen.findByText("Couldn't add task")).toBeInTheDocument();
    expect(screen.queryByText('Added to Inbox')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderCapture(post(), onClose);

    await user.type(field(), 'never mind{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.createItem).not.toHaveBeenCalled();
  });

  it('makes a double-pressed Enter one item, not two', async () => {
    mockApi.createItem.mockReturnValue(new Promise<Item>(() => {}));
    const user = userEvent.setup();
    renderCapture();

    await user.type(field(), 'Once{Enter}{Enter}');

    expect(mockApi.createItem).toHaveBeenCalledTimes(1);
  });
});
