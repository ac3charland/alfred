import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import { useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderPostListItem } from '@/lib/types';

import { FurtherReading } from './further-reading';
import { renderReader } from './test-helpers';

// A partial mock: the send is stubbed, but `ApiError` stays the real class, since the store
// quotes the route's own sentence from it.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  sendReaderFurtherReading: jest.fn(),
}));
const mockApi = jest.mocked(api);

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const POST_ID = '11111111-1111-4111-8111-111111111111';
const ITEMS = makeFurtherReading();
const [GAP, TRANSFER, FOLDBENCH, SCEPTIC] = ITEMS as [
  (typeof ITEMS)[0],
  (typeof ITEMS)[0],
  (typeof ITEMS)[0],
  (typeof ITEMS)[0],
];

function post(sent: { reader?: string[]; instapaper?: string[] } = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost(PUBLICATION_ID, {
    id: POST_ID,
    summary_state: 'done',
    overview: makeReaderOverview({ further_reading: ITEMS }),
    further_sent_reader: sent.reader ?? [],
    further_sent_instapaper: sent.instapaper ?? [],
  });
  return row;
}

/** The section as the overview mounts it: fed from the store, so a reconciled send redraws it. */
function LiveFurtherReading() {
  const row = useReaderPosts().find((candidate) => candidate.id === POST_ID);
  if (row === undefined) return null;
  return (
    <FurtherReading
      postId={row.id}
      items={ITEMS}
      sentReader={row.further_sent_reader}
      sentInstapaper={row.further_sent_instapaper}
    />
  );
}

function renderSection(row: ReaderPostListItem = post(), instapaperConfigured = true) {
  return renderReader(<LiveFurtherReading />, [row], undefined, { instapaperConfigured });
}

function checkbox(title: string): HTMLElement {
  return screen.getByRole('checkbox', { name: new RegExp(title.slice(0, 20)) });
}

function bar(): HTMLElement {
  return screen.getByRole('group', { name: 'Selected links' });
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('FurtherReading — the checklist', () => {
  it('draws each item as a checkbox holding its title and note, unticked', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: 'Further reading' })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box).toHaveAttribute('aria-checked', 'false');
    expect(within(checkbox(GAP.title)).getByText(GAP.title)).toHaveClass('font-medium');
    expect(within(checkbox(GAP.title)).getByText(GAP.note)).toHaveClass('text-muted-foreground');
  });

  it('gives each item an open link to its URL in a new tab, beside the checkbox and not inside it', () => {
    renderSection();

    const link = screen.getByRole('link', { name: `Open ${GAP.title}` });
    expect(link).toHaveAttribute('href', GAP.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(checkbox(GAP.title)).not.toContainElement(link);
    expect(link.closest('button')).toBeNull();
  });

  it('ticks on click and on Space, and does nothing on Enter', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(checkbox(GAP.title));
    expect(checkbox(GAP.title)).toHaveAttribute('aria-checked', 'true');

    checkbox(TRANSFER.title).focus();
    await user.keyboard('{Enter}');
    expect(checkbox(TRANSFER.title)).toHaveAttribute('aria-checked', 'false');
    await user.keyboard(' ');
    expect(checkbox(TRANSFER.title)).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the bar with its count, both sends and Clear only once something is ticked', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.queryByRole('group', { name: 'Selected links' })).not.toBeInTheDocument();
    await user.click(checkbox(GAP.title));
    await user.click(checkbox(FOLDBENCH.title));

    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Send to Reader' })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Send to Instapaper' })).toBeInTheDocument();
    await user.click(within(bar()).getByRole('button', { name: 'Clear' }));
    expect(checkbox(GAP.title)).toHaveAttribute('aria-checked', 'false');
  });

  it('Select all ticks only the unsent items, then becomes Deselect all', async () => {
    const user = userEvent.setup();
    renderSection(post({ reader: [GAP.url] }));

    await user.click(screen.getByRole('button', { name: 'Select all Further reading' }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAttribute('aria-checked', 'true');
    }
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deselect all Further reading' }));
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }
  });
});

describe('FurtherReading — sent items', () => {
  it('marks a link in Reader green and one in Instapaper muted, neither tickable, both openable', () => {
    renderSection(post({ reader: [GAP.url], instapaper: [FOLDBENCH.url] }));

    expect(screen.queryByRole('checkbox', { name: /sim-to-real/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /FoldBench/ })).not.toBeInTheDocument();
    expect(screen.getByText('In Reader')).toHaveClass('text-accent-green');
    expect(screen.getByText('In Instapaper')).toHaveClass('text-muted-foreground');
    expect(screen.getByRole('link', { name: `Open ${GAP.title}` })).toHaveAttribute(
      'href',
      GAP.url,
    );
    expect(screen.getByRole('link', { name: `Open ${FOLDBENCH.title}` })).toBeInTheDocument();
  });

  it('reads “In Reader” for a link in both lists', () => {
    renderSection(post({ reader: [GAP.url], instapaper: [GAP.url] }));

    expect(screen.getByText('In Reader')).toBeInTheDocument();
    expect(screen.queryByText('In Instapaper')).not.toBeInTheDocument();
  });

  it('says All sent once nothing is left to tick', () => {
    renderSection(
      post({ reader: [GAP.url, TRANSFER.url], instapaper: [FOLDBENCH.url, SCEPTIC.url] }),
    );

    expect(screen.getByText('All sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument();
  });
});

describe('FurtherReading — sending', () => {
  it('sends the ticked links to the Reader and marks them from the row the server wrote', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockResolvedValue({
      post: post({ reader: [GAP.url, SCEPTIC.url] }),
      unsent: [],
    });
    renderSection();

    await user.click(checkbox(GAP.title));
    await user.click(checkbox(SCEPTIC.title));
    await user.click(within(bar()).getByRole('button', { name: 'Send to Reader' }));

    expect(mockApi.sendReaderFurtherReading).toHaveBeenCalledWith(POST_ID, {
      destination: 'reader',
      urls: [GAP.url, SCEPTIC.url],
    });
    await waitFor(() => {
      expect(screen.getAllByText('In Reader')).toHaveLength(2);
    });
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('sends to Instapaper with its own button', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockResolvedValue({
      post: post({ instapaper: [FOLDBENCH.url] }),
      unsent: [],
    });
    renderSection();

    await user.click(checkbox(FOLDBENCH.title));
    await user.click(within(bar()).getByRole('button', { name: 'Send to Instapaper' }));

    expect(mockApi.sendReaderFurtherReading).toHaveBeenCalledWith(POST_ID, {
      destination: 'instapaper',
      urls: [FOLDBENCH.url],
    });
    expect(await screen.findByText('In Instapaper')).toBeInTheDocument();
  });

  it('disables every control while a send is in flight, the pressed button reading Sending…', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockReturnValue(new Promise(() => {}));
    renderSection();

    await user.click(checkbox(GAP.title));
    await user.click(within(bar()).getByRole('button', { name: 'Send to Reader' }));

    expect(within(bar()).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(within(bar()).getByRole('button', { name: 'Send to Instapaper' })).toBeDisabled();
    expect(within(bar()).getByRole('button', { name: 'Clear' })).toBeDisabled();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: /Select all/ })).toBeDisabled();
  });

  it('keeps a partial send’s unsent links ticked and toasts what landed', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockResolvedValue({
      post: post({ reader: [GAP.url] }),
      unsent: [SCEPTIC.url],
      failure: "Instapaper didn't answer",
    });
    renderSection();

    await user.click(checkbox(GAP.title));
    await user.click(checkbox(SCEPTIC.title));
    await user.click(within(bar()).getByRole('button', { name: 'Send to Reader' }));

    expect(
      await screen.findByText("Sent 1 of 2 to Reader — Instapaper didn't answer for the other"),
    ).toBeInTheDocument();
    expect(screen.getByText('In Reader')).toBeInTheDocument();
    expect(checkbox(SCEPTIC.title)).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
  });

  it('keeps every tick when nothing landed, and toasts the route’s sentence', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockRejectedValue(
      new api.ApiError('API POST failed: 409', 409, 'There is no “To Reader” folder in Instapaper'),
    );
    renderSection();

    await user.click(checkbox(GAP.title));
    await user.click(within(bar()).getByRole('button', { name: 'Send to Reader' }));

    expect(
      await screen.findByText('There is no “To Reader” folder in Instapaper'),
    ).toBeInTheDocument();
    expect(checkbox(GAP.title)).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByRole('button', { name: 'Send to Reader' })).toBeEnabled();
  });
});

describe('FurtherReading — without Instapaper', () => {
  it('is a plain list of links with the notes, and no ticks or bar', () => {
    renderSection(post(), false);

    expect(screen.getByRole('heading', { name: 'Further reading' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: GAP.title });
    expect(link).toHaveAttribute('href', GAP.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(`— ${GAP.note}`)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
