import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { COMMS_LIVE_WINDOW_MS, COMMS_POLL_MS, SHELF_PAGE_SIZE } from '@/lib/comms';
import { makeCommAccount, makeCommMessage, makeCommsSeed } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';
import type { CommAccount, CommMessage, CommsSeed } from '@/lib/types';

import { CommsQueueView } from './comms-queue-view';

jest.mock('@/lib/api-client');

/**
 * The view is the composition: three counted tiers, an unbadged shelf, and one selection moving
 * across the lot. What is pinned here is the shape a reader is promised — that a counted tier
 * counts, that the shelf stays shut, and that the keyboard walks the queue in the order it is
 * drawn.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const GMAIL: CommAccount = makeCommAccount('RealPlay', {
  id: '00000000-0000-4000-8000-0000000000a1',
  last_seen_at: new Date(NOW.getTime() - 60 * 1000).toISOString(),
});

let sequence = 0;
function row(overrides: Partial<CommMessage> = {}): CommMessage {
  sequence += 1;
  return makeCommMessage(GMAIL.id, {
    id: `00000000-0000-4000-8000-00000000${String(sequence).padStart(4, '0')}`,
    judged_by: 'model',
    received_at: new Date(NOW.getTime() - sequence * 60 * 1000).toISOString(),
    ...overrides,
  });
}

function renderView(messages: CommMessage[]) {
  return renderWithProviders(<CommsQueueView now={NOW} />, {
    comms: { accounts: [GMAIL], messages },
  });
}

beforeEach(() => {
  sequence = 0;
});

/**
 * The selected row's own trigger. Scoped past `aria-expanded` alone, because the FYI shelf's
 * disclosure carries the same attribute and would otherwise answer for a row.
 */
function selectedRow(): HTMLElement | undefined {
  return screen
    .queryAllByRole('button', { expanded: true })
    .find((element) => element.closest('[data-testid="comms-row"]') !== null);
}

describe('CommsQueueView — the resting state', () => {
  it('says nothing is owed rather than reading as an error', () => {
    renderView([]);

    expect(screen.getByText('Nothing to answer.')).toBeInTheDocument();
    expect(screen.getByText(/Everything else lands on the FYI shelf\./)).toBeInTheDocument();
  });

  it('names an empty Today, and leaves the other tiers to speak for themselves', () => {
    renderView([row({ tier: 'whenever', ask: 'Wants an intro.' })]);

    expect(screen.getByText('Nothing to answer today.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'ASAP' })).queryByText(/Nothing/)).toBeNull();
  });
});

/** A day with one row in every tier plus one on the shelf. */
function badDay(): CommMessage[] {
  return [
    row({ tier: 'asap', ask: 'Needs the invoice approved.' }),
    row({ tier: 'today', ask: 'Asking whether you are coming Sunday.' }),
    row({ tier: 'today', ask: 'Waiting on your availability.' }),
    row({ tier: 'whenever', ask: 'Asked for an intro.' }),
    row({ tier: 'fyi', ask: 'A receipt.' }),
  ];
}

describe('CommsQueueView — the three counted tiers', () => {
  it('counts each tier, and never counts the shelf', () => {
    renderView(badDay());

    expect(screen.getByLabelText('1 in ASAP')).toHaveTextContent('1');
    expect(screen.getByLabelText('2 in Today')).toHaveTextContent('2');
    expect(screen.getByLabelText('1 in Whenever')).toHaveTextContent('1');
    expect(screen.queryByLabelText(/in FYI/)).not.toBeInTheDocument();
  });

  it('keeps the shelf collapsed, with its size in the summary rather than a badge', () => {
    renderView(badDay());

    const toggle = screen.getByRole('button', { name: /FYI · 1 message · no reply owed/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('says how many newsletters went to the Reader, with a link, and keeps them off the shelf', () => {
    renderView([
      ...badDay(),
      row({
        tier: 'fyi',
        judged_by: 'filter',
        filtered_reason: 'newsletter',
        subject: 'Import AI 412',
        reader_claimed_at: NOW.toISOString(),
      }),
      row({
        tier: 'fyi',
        judged_by: 'filter',
        filtered_reason: 'newsletter',
        subject: 'Second Thoughts',
        reader_claimed_at: NOW.toISOString(),
      }),
    ]);

    // The two claimed rows are not counted on the shelf's own line…
    expect(screen.getByRole('button', { name: /FYI · 1 message · no reply owed/ })).toBeVisible();
    // …but they are named beneath it, with the way there.
    const link = screen.getByRole('link', { name: /Reader/ });
    expect(link).toHaveAttribute('href', '/reader');
    expect(link.closest('p')).toHaveTextContent('2 newsletters went to the Reader');
  });

  it('draws no Reader line when nothing has been claimed', () => {
    renderView(badDay());

    expect(screen.queryByText(/went to the Reader/)).not.toBeInTheDocument();
  });

  it('opens the shelf on request', async () => {
    const user = userEvent.setup();
    renderView(badDay());

    await user.click(screen.getByRole('button', { name: /FYI · 1 message/ }));

    expect(screen.getByRole('button', { name: /FYI · 1 message/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('A receipt.')).toBeInTheDocument();
  });

  it('holds one page of the shelf, counts all of it, and asks for the next page on request', async () => {
    const user = userEvent.setup();
    const shelf = Array.from({ length: SHELF_PAGE_SIZE + 10 }, () => row({ tier: 'fyi' }));
    jest
      .mocked(api)
      .fetchCommsSnapshot.mockResolvedValue(makeCommsSeed({ accounts: [GMAIL], messages: shelf }));
    renderView(shelf);

    await user.click(screen.getByRole('button', { name: /FYI · 60 messages/ }));

    expect(screen.getAllByTestId('comms-row')).toHaveLength(SHELF_PAGE_SIZE);
    jest
      .mocked(api)
      .fetchCommsSnapshot.mockResolvedValue(
        makeCommsSeed({ accounts: [GMAIL], messages: shelf, shelfLimit: SHELF_PAGE_SIZE * 2 }),
      );
    await user.click(screen.getByRole('button', { name: 'Show more (10 older)' }));

    expect(jest.mocked(api).fetchCommsSnapshot).toHaveBeenLastCalledWith(SHELF_PAGE_SIZE * 2);
    expect(await screen.findAllByTestId('comms-row')).toHaveLength(shelf.length);
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('keeps the shelf in view when the last queued row is cleared before the server has counted it', async () => {
    const user = userEvent.setup();
    jest.mocked(api).clearCommMessage.mockReturnValue(new Promise(() => {}));
    renderView([row({ tier: 'today', ask: 'Asking whether you are coming Sunday.' })]);

    await user.click(screen.getByText('Asking whether you are coming Sunday.'));
    await user.click(screen.getByRole('button', { name: 'Not replying' }));
    const collapsed = new Event('transitionend', { bubbles: true });
    Object.defineProperty(collapsed, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(screen.getByTestId('comms-row-collapse'), collapsed);

    // The server's shelf count is still 0 — the row it is about to count is only held here.
    expect(screen.queryByText('Nothing to answer.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /FYI · 1 message/ })).toBeInTheDocument();
  });
});

describe('CommsQueueView — keyboard selection', () => {
  it('selects the first row on j, then walks down the queue as drawn', () => {
    renderView([
      row({ tier: 'asap', ask: 'The ASAP one.' }),
      row({ tier: 'today', ask: 'The Today one.' }),
    ]);

    fireEvent.keyDown(document, { key: 'j' });
    expect(selectedRow()).toHaveTextContent('The ASAP one.');

    fireEvent.keyDown(document, { key: 'j' });
    expect(selectedRow()).toHaveTextContent('The Today one.');
  });

  it('walks back up on k and holds at the top rather than wrapping', () => {
    renderView([
      row({ tier: 'asap', ask: 'The ASAP one.' }),
      row({ tier: 'today', ask: 'The Today one.' }),
    ]);

    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'k' });
    expect(selectedRow()).toHaveTextContent('The ASAP one.');

    fireEvent.keyDown(document, { key: 'k' });
    expect(selectedRow()).toHaveTextContent('The ASAP one.');
  });

  it('holds at the bottom too', () => {
    renderView([row({ tier: 'asap', ask: 'The only one.' })]);

    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });

    expect(selectedRow()).toHaveTextContent('The only one.');
  });

  it('drops the selection on Escape', () => {
    renderView([row({ tier: 'asap', ask: 'The ASAP one.' })]);

    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(selectedRow()).toBeUndefined();
  });

  it('leaves shelf rows out of the walk until the shelf is open', async () => {
    const user = userEvent.setup();
    renderView([
      row({ tier: 'asap', ask: 'The queued one.' }),
      row({ tier: 'fyi', ask: 'Shelved.' }),
    ]);

    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });
    expect(selectedRow()).toHaveTextContent('The queued one.');

    await user.click(screen.getByRole('button', { name: /FYI · 1 message/ }));
    fireEvent.keyDown(document, { key: 'j' });
    expect(selectedRow()).toHaveTextContent('Shelved.');
  });

  it('ignores navigation typed into a field', () => {
    renderView([row({ tier: 'asap', ask: 'The ASAP one.' })]);
    const field = document.createElement('input');
    document.body.append(field);

    fireEvent.keyDown(field, { key: 'j' });

    expect(selectedRow()).toBeUndefined();
    field.remove();
  });
});

describe('CommsQueueView — one selection at a time', () => {
  it('moves the expansion rather than opening a second row', async () => {
    const user = userEvent.setup();
    renderView([
      row({ tier: 'asap', ask: 'The ASAP one.' }),
      row({ tier: 'today', ask: 'The Today one.' }),
    ]);

    await user.click(screen.getByText('The ASAP one.'));
    await user.click(screen.getByText('The Today one.'));

    expect(
      screen
        .queryAllByRole('button', { expanded: true })
        .filter((element) => element.closest('[data-testid="comms-row"]') !== null),
    ).toHaveLength(1);
    expect(selectedRow()).toHaveTextContent('The Today one.');
  });
});

describe('CommsQueueView — adding the sender of a mistiered row', () => {
  it('opens the roster dialog prefilled from the message', async () => {
    const user = userEvent.setup();
    renderView([
      row({ tier: 'asap', ask: 'The ASAP one.', sender_name: 'Dana W.', sender_handle: 'd@x.com' }),
    ]);

    await user.click(screen.getByText('The ASAP one.'));
    await user.click(screen.getByRole('button', { name: /Add sender to people/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Dana W.');
    expect(within(dialog).getByText(/Adding d@x\.com here/)).toBeInTheDocument();
  });

  it('writes the roster row and closes', async () => {
    const user = userEvent.setup();
    jest.mocked(api).createCommPerson.mockResolvedValue({
      id: 'p1',
      name: 'Dana W.',
      priority: 'high',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      comm_handles: [],
    });
    renderView([
      row({ tier: 'asap', ask: 'The ASAP one.', sender_name: 'Dana W.', sender_handle: 'd@x.com' }),
    ]);

    await user.click(screen.getByText('The ASAP one.'));
    await user.click(screen.getByRole('button', { name: /Add sender to people/ }));
    await user.click(await screen.findByRole('button', { name: 'Add to people' }));

    expect(jest.mocked(api).createCommPerson).toHaveBeenCalledWith({
      name: 'Dana W.',
      priority: 'high',
      handles: [{ handle: 'd@x.com', kind: 'email' }],
    });
  });
});

/**
 * ALF-227, at the surface the report describes. The view's clock ticks on its own, so a
 * `last_seen_at` the tab stopped hearing about decays into "stale" with no change on the server
 * at all — every source disconnected on a page that has simply been open too long.
 */
describe('CommsQueueView — a tab that has been away', () => {
  const OPENED = new Date('2026-09-09T12:00:00.000Z');
  const LIVE = makeCommAccount('RealPlay', {
    id: '00000000-0000-4000-8000-0000000000b1',
    last_seen_at: new Date(OPENED.getTime() - 60 * 1000).toISOString(),
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  it('re-reads the view on return, so an hour away does not read as an outage', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    // The Reader store the providers mount refreshes on the same signal, so the automocked
    // client has to answer it too — otherwise its `undefined` return is awaited as a promise.
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    // What the poller has been doing the whole hour the tab was away.
    jest.mocked(api).fetchCommsSnapshot.mockResolvedValue(
      makeCommsSeed({
        accounts: [
          { ...LIVE, last_seen_at: new Date(OPENED.getTime() + 59 * 60 * 1000).toISOString() },
        ],
      }),
    );
    // No `now` prop: this is the view's own ticking clock, which is half the defect.
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });
    expect(screen.getByLabelText('RealPlay · live')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(screen.getByLabelText('RealPlay · stale')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByLabelText('RealPlay · live')).toBeInTheDocument();
  });

  it('brings in a message that arrived while it was away', async () => {
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    const arrived = makeCommMessage(LIVE.id, {
      tier: 'asap',
      judged_by: 'model',
      ask: 'Needs the contract signed before noon.',
    });
    jest
      .mocked(api)
      .fetchCommsSnapshot.mockResolvedValue(
        makeCommsSeed({ accounts: [LIVE], messages: [arrived] }),
      );
    renderWithProviders(<CommsQueueView now={OPENED} />, {
      comms: { accounts: [LIVE], messages: [] },
    });
    expect(screen.getByText('Nothing to answer.')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Needs the contract signed before noon.')).toBeInTheDocument();
  });

  it('says it is not live once every poll has failed for long enough', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('offline'));
    // No `now` prop: liveness compares `lastReadAt` (the store's own clock) against the view's
    // own ticking clock, so the two have to share one — the ticking ONE, not a pinned prop.
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(() => jest.advanceTimersByTimeAsync(COMMS_LIVE_WINDOW_MS + COMMS_POLL_MS));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here/);
  });

  it('shows nothing as the queue until a read lands when the shell could not load it', async () => {
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    const arrived = makeCommMessage(LIVE.id, {
      tier: 'asap',
      judged_by: 'model',
      ask: 'Needs the contract signed before noon.',
    });
    const read = { resolve: (_seed: CommsSeed) => {} };
    jest
      .mocked(api)
      .fetchCommsSnapshot.mockRejectedValueOnce(new Error('down'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          read.resolve = resolve;
        }),
      );
    renderWithProviders(<CommsQueueView now={OPENED} />, {
      // A live account seeded alongside the failed shell read, so what follows proves the dot
      // is withheld deliberately — not just absent for lack of any account to draw.
      comms: { accounts: [LIVE], messages: [], failed: true },
    });
    await act(async () => {
      await Promise.resolve();
    });

    // A queue that was never read is not an empty one.
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load Comms — retrying.");
    expect(screen.queryByText('Nothing to answer.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'ASAP' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-dots')).not.toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      read.resolve(makeCommsSeed({ accounts: [LIVE], messages: [arrived] }));
      await Promise.resolve();
    });

    expect(await screen.findByText('Needs the contract signed before noon.')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load Comms/)).not.toBeInTheDocument();
  });

  it('dates "not live" from the last successful read, not from a failed retry since', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('down'));
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });

    // An hour of every poll failing in turn: the anchor is the last read that WORKED (the mount
    // seed), not the most recent attempt — so the "ago" grows with the whole hour, not resets.
    await act(() => jest.advanceTimersByTimeAsync(60 * 60 * 1000));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here 1h ago/);
  });
});
