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

    expect(jest.mocked(api).fetchCommsSnapshot).toHaveBeenLastCalledWith(SHELF_PAGE_SIZE * 2, []);
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
    // The Reader and Wiki stores the providers mount refresh on the same signal, so the
    // automocked client has to answer both too — otherwise their `undefined` return is awaited
    // as a promise.
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchWikiPages.mockResolvedValue({ pages: [], sync: null });
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
    jest.mocked(api).fetchWikiPages.mockResolvedValue({ pages: [], sync: null });
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

  it('holds an account dot live through the reconnect read, even as it crosses stale while out', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchWikiPages.mockResolvedValue({ pages: [], sync: null });
    const account = makeCommAccount('RealPlay', {
      id: '00000000-0000-4000-8000-0000000000c1',
      expected_interval_seconds: 60,
      last_seen_at: new Date(OPENED.getTime() - 58_000).toISOString(),
    });
    const read = { resolve: (_seed: CommsSeed) => {} };
    jest.mocked(api).fetchCommsSnapshot.mockReturnValue(
      new Promise((resolve) => {
        read.resolve = resolve;
      }),
    );
    const { rerender } = renderWithProviders(<CommsQueueView now={OPENED} />, {
      comms: { accounts: [account], messages: [] },
    });
    expect(screen.getByLabelText('RealPlay · live')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The account's own 60s interval passes while the reconnect read this just launched is
    // still out — inside the reconnect's own short grace window, not the (much longer) time it
    // would take to make this account look overdue on its own.
    const stillOut = new Date(OPENED.getTime() + 3000);
    jest.setSystemTime(stillOut);
    rerender(<CommsQueueView now={stillOut} />);
    expect(screen.getByLabelText('RealPlay · live')).toBeInTheDocument();

    await act(async () => {
      read.resolve(makeCommsSeed({ accounts: [account], messages: [] }));
      await Promise.resolve();
    });

    // The read landed and confirmed nothing new — now the true state shows for real.
    expect(screen.getByLabelText('RealPlay · stale')).toBeInTheDocument();
  });

  it('says it is not live once every poll has failed for long enough', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('offline'));
    // No `now` prop: liveness is `useCommsLive`'s own 1s re-check, independent of the pinned
    // `now` that drives everything else drawn here.
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(() => jest.advanceTimersByTimeAsync(COMMS_LIVE_WINDOW_MS + COMMS_POLL_MS));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here/);
  });

  it('flips to not-live within 1s of the window, even mounted off a 30s tick boundary', async () => {
    jest.useFakeTimers();
    // 26s past the read the mount seed lands at — deliberately NOT a multiple of 30s, so a
    // liveness check still riding `useNow`'s bucketed, unaligned-interval clock flips late
    // (as late as ~120s here) instead of within 1s of `COMMS_LIVE_WINDOW_MS`.
    jest.setSystemTime(new Date(OPENED.getTime() + 26_000));
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('offline'));
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // `isCommsLive` treats an elapsed time equal to the window as still live.
    await act(() => jest.advanceTimersByTimeAsync(COMMS_LIVE_WINDOW_MS));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // `useCommsLive`'s own re-check runs every 1s, not on an exact deadline — 1s covers it.
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here/);
  });

  it('shows nothing as the queue until a read lands when the shell could not load it', async () => {
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchWikiPages.mockResolvedValue({ pages: [], sync: null });
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

  it('reads the flip as "1m ago", never "just now", even when the view\'s own 30s clock lags', async () => {
    jest.useFakeTimers();
    // 3s past a 30s boundary — deliberately not aligned, so the view's own bucketed clock
    // (`useNow`) can still read under a minute past the mount's read even though the live window
    // itself is over a minute (`COMMS_LIVE_WINDOW_MS` = 65s) — the exact gap that read "just now".
    jest.setSystemTime(new Date(OPENED.getTime() + 3000));
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('offline'));
    // No `now` prop: the header's "ago" text has to come out right off the view's own ticking
    // clock, the same clock the bug rode.
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });

    // `useCommsLive` re-checks every 1s rather than on an exact deadline, so the flip lands
    // within 1s of the window rather than exactly +1ms past it.
    await act(() => jest.advanceTimersByTimeAsync(COMMS_LIVE_WINDOW_MS + 1000));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here 1m ago/);
  });

  it('dates "not live" from the last successful read, not from a failed retry since', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('down'));
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });

    // Several polls fail in turn, then an hour passes: the anchor is the last read that WORKED
    // (the mount seed), not the most recent attempt — so the "ago" grows with the whole hour.
    await act(() => jest.advanceTimersByTimeAsync(3 * COMMS_POLL_MS));
    jest.setSystemTime(new Date(OPENED.getTime() + 60 * 60 * 1000));
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(jest.mocked(api).fetchCommsSnapshot).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here 1h ago/);
  });

  it('an already not-live view updates its "ago" and account dot within ~1s of waking from sleep', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('offline'));
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });

    // Already not-live before the sleep.
    await act(() => jest.advanceTimersByTimeAsync(COMMS_LIVE_WINDOW_MS + 1000));
    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here 1m ago/);

    // Sleep: the wall clock jumps 8h, but monotonic timers don't advance for the gap itself —
    // only the ~1s of real timer advance below runs, the same as a real wake.
    jest.setSystemTime(new Date(Date.now() + 8 * 3_600_000));
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here 8h ago/);
    expect(screen.getByLabelText('RealPlay · stale')).toBeInTheDocument();
  });

  it('a live view that sleeps 8h with no visibility/pageshow event still flips within ~1s', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(OPENED);
    jest.mocked(api).fetchReaderPosts.mockResolvedValue([]);
    jest.mocked(api).fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
    jest.mocked(api).fetchCommsSnapshot.mockRejectedValue(new Error('offline'));
    renderWithProviders(<CommsQueueView />, { comms: { accounts: [LIVE], messages: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Sleep: the wall clock jumps 8h; no `visibilitychange`/`pageshow` fires on this wake, so
    // only the view's 1s re-checks (`useCommsLive`, and `useNow` changing bucket) can catch it.
    jest.setSystemTime(new Date(Date.now() + 8 * 3_600_000));
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(screen.getByRole('alert')).toHaveTextContent(/^Not live — this is what was here 8h ago/);
  });
});

/** What a browser coming back online fires: the simplest of the triggers that re-read. */
async function poll(): Promise<void> {
  await act(async () => {
    globalThis.dispatchEvent(new Event('online'));
    await Promise.resolve();
  });
}

/**
 * A re-run is answered a minute or three later by a Worker this tab never hears from, so the row
 * has to say the request went somewhere — and the tab has to say what became of it. The journey
 * runs through the real store: the click, the wait, and the poll that finds the request cleared.
 */
describe('CommsQueueView — asking for a re-run', () => {
  const ASK = 'Asking whether you are coming Sunday.';
  const STAMP = '2026-09-09T11:59:30.123456+00:00';

  /** Dana's row, on Today, with the sender's own name to read as. */
  function danaRow(overrides: Partial<CommMessage> = {}): CommMessage {
    return row({ tier: 'today', sender_name: 'Dana Whitfield', ask: ASK, ...overrides });
  }

  async function openAndAskForRerun(): Promise<void> {
    const user = userEvent.setup();
    await user.click(screen.getByText(ASK));
    await user.click(screen.getByRole('button', { name: 'Re-run classifier' }));
  }

  it('says at once that the request was made, on the button and on the collapsed row', async () => {
    const dana = danaRow();
    jest
      .mocked(api)
      .requestReclassify.mockResolvedValue({ ...dana, reclassify_requested_at: STAMP });
    renderView([dana]);

    await openAndAskForRerun();

    const button = screen.getByRole('button', { name: /Re-run requested/ });
    expect(button).toBeDisabled();
    expect(within(button).getByRole('status', { name: 'Re-run pending' })).toBeInTheDocument();
    expect(screen.getByText('Re-run pending')).toBeInTheDocument();
  });

  it('says how the verdict changed, once, when the poll finds the request cleared', async () => {
    const dana = danaRow();
    jest
      .mocked(api)
      .requestReclassify.mockResolvedValue({ ...dana, reclassify_requested_at: STAMP });
    renderView([dana]);
    await openAndAskForRerun();

    const answered = { ...dana, tier: 'asap' as const, reclassify_requested_at: null };
    jest
      .mocked(api)
      .fetchCommsSnapshot.mockResolvedValue(
        makeCommsSeed({ accounts: [GMAIL], messages: [answered], watched: [answered] }),
      );
    await poll();

    expect(await screen.findByText('Re-run · Dana Whitfield: Today → ASAP')).toBeInTheDocument();
    expect(screen.queryByText('Re-run pending')).not.toBeInTheDocument();
    // Nothing more to say on the next poll: the re-run is over.
    await poll();
    expect(screen.getAllByText(/^Re-run · /)).toHaveLength(1);
  });

  it('says so when nothing changed, rather than leaving the owner to wonder', async () => {
    const dana = danaRow();
    jest
      .mocked(api)
      .requestReclassify.mockResolvedValue({ ...dana, reclassify_requested_at: STAMP });
    renderView([dana]);
    await openAndAskForRerun();

    const answered = { ...dana, reclassify_requested_at: null };
    jest
      .mocked(api)
      .fetchCommsSnapshot.mockResolvedValue(
        makeCommsSeed({ accounts: [GMAIL], messages: [answered], watched: [answered] }),
      );
    await poll();

    expect(await screen.findByText('Re-run · Dana Whitfield: still Today')).toBeInTheDocument();
  });

  it('puts the row back and says why when the request never got through', async () => {
    jest.mocked(api).requestReclassify.mockRejectedValue(new Error('offline'));
    renderView([danaRow()]);

    await openAndAskForRerun();

    expect(await screen.findByText("Couldn't ask for a re-run")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-run classifier' })).toBeEnabled();
    expect(screen.queryByText('Re-run pending')).not.toBeInTheDocument();
  });

  it('gives the collapsed row no chip when its re-run was given up on', () => {
    renderView([danaRow({ reclassify_failed_at: new Date(2026, 8, 9, 11, 58).toISOString() })]);

    // Collapsed: no chip — the verdict stands, so the module is not wrong about the row.
    expect(screen.queryByText('Re-run pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-markers')).not.toBeInTheDocument();
  });
});

/** A thread on the shelf: one row per message, newest first, all sharing `thread`. */
function thread(name: string, messages: Partial<CommMessage>[]): CommMessage[] {
  return messages.map((overrides) => row({ tier: 'fyi', thread_key: name, ...overrides }));
}

/** The conversation header whose text matches `name`. */
function header(name: RegExp): HTMLElement {
  const match = screen
    .getAllByRole('button')
    .find(
      (element) =>
        element.closest('[data-testid="comms-conversation"]') !== null &&
        name.test(element.textContent),
    );
  if (match === undefined) throw new Error(`no conversation header matching ${String(name)}`);
  return match;
}

/** The message list a conversation header says it controls. */
function messageList(conversationHeader: HTMLElement): HTMLElement {
  const id = conversationHeader.getAttribute('aria-controls') ?? '';
  const list = document.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  if (list === null) throw new Error(`no element controlled as ${id}`);
  return list;
}

/** The collapse wrapping the selected row — where its exit animation ends. */
function selectedRowCollapse(): HTMLElement {
  const collapse = selectedRow()?.closest<HTMLElement>('[data-testid="comms-row-collapse"]');
  if (collapse === null || collapse === undefined) throw new Error('no selected row');
  return collapse;
}

async function openShelf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /FYI · \d+ messages?/ }));
}

/** A three-message email thread with three senders, one of them refused. */
function potluck(): CommMessage[] {
  return thread('potluck', [
    { sender_handle: 'dana@example.com', sender_name: 'Dana', subject: 'Re: potluck — final' },
    {
      sender_handle: 'ana@example.com',
      sender_name: 'Ana',
      subject: 'Re: potluck',
      judged_by: 'refusal',
    },
    { sender_handle: 'lee@example.com', sender_name: 'Lee', subject: 'Re: potluck — +1' },
  ]);
}

describe('CommsQueueView — conversations on the shelf', () => {
  it('draws one row per conversation, its size a sentence in the meta line rather than a badge', async () => {
    const user = userEvent.setup();
    renderView([
      ...potluck(),
      row({ tier: 'fyi', sender_name: 'Chase', subject: 'Statement ready' }),
    ]);

    await openShelf(user);

    expect(screen.getAllByTestId('comms-conversation')).toHaveLength(1);
    const potluckHeader = header(/Dana, Ana \+1/);
    expect(potluckHeader).toHaveAccessibleName(/Dana, Ana \+1.*3 messages/);
    expect(within(potluckHeader).getByText(/· 3 messages/)).toHaveClass('text-xs');
    // The newest message's line, attributed because the thread has several senders.
    expect(within(potluckHeader).getByText('Dana: Re: potluck — final')).toBeInTheDocument();
    // The shelf summary still counts messages, not conversations.
    expect(screen.getByRole('button', { name: /FYI · 4 messages/ })).toBeInTheDocument();
  });

  it('draws a one-message conversation exactly as a shelf row, with no count', async () => {
    const user = userEvent.setup();
    renderView([row({ tier: 'fyi', sender_name: 'Chase', subject: 'Statement ready' })]);

    await openShelf(user);

    expect(screen.queryByTestId('comms-conversation')).not.toBeInTheDocument();
    expect(screen.getByTestId('comms-row')).toHaveTextContent('Statement ready');
    expect(screen.queryByText(/messages$/)).not.toBeInTheDocument();
  });

  it('carries every chip its messages do, counted where more than one carries it', async () => {
    const user = userEvent.setup();
    renderView(
      thread('chat', [
        { has_attachments: true, body: '' },
        { has_attachments: true, body: '', judged_by: 'refusal' },
        { body: 'ok' },
      ]),
    );

    await openShelf(user);

    const chips = within(header(/3 messages/)).getByTestId('row-markers');
    expect(
      within(chips)
        .getAllByText(/./)
        .map((chip) => chip.textContent),
    ).toEqual(['Attachment · not read · 2', 'Refused']);
  });

  it('opens on a click, listing its messages as full rows newest first, and closes on another', async () => {
    const user = userEvent.setup();
    renderView(potluck());
    await openShelf(user);
    const potluckHeader = header(/3 messages/);
    expect(potluckHeader).toHaveAttribute('aria-expanded', 'false');

    await user.click(potluckHeader);

    expect(potluckHeader).toHaveAttribute('aria-expanded', 'true');
    const rows = within(messageList(potluckHeader)).getAllByTestId('comms-row');
    expect(rows.map((element) => element.textContent)).toEqual([
      expect.stringContaining('Re: potluck — final'),
      expect.stringContaining('Re: potluck'),
      expect.stringContaining('Re: potluck — +1'),
    ]);
    // Full shelf rows: the inside one still says it was refused.
    expect(within(rows[1] ?? document.body).getByText('Refused')).toBeInTheDocument();

    await user.click(potluckHeader);
    expect(potluckHeader).toHaveAttribute('aria-expanded', 'false');
  });

  it('walks onto a conversation with j, through its messages, and past it — one open at a time', async () => {
    const user = userEvent.setup();
    renderView([
      ...thread('a', [{ subject: 'A newest' }, { subject: 'A oldest' }]),
      ...thread('b', [{ subject: 'B newest' }, { subject: 'B oldest' }]),
    ]);
    await openShelf(user);
    const a = header(/A newest/);
    const b = header(/B newest/);

    fireEvent.keyDown(document, { key: 'j' });
    expect(a).toHaveAttribute('aria-expanded', 'true');
    expect(b).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(document, { key: 'j' });
    expect(selectedRow()).toHaveTextContent('A newest');
    fireEvent.keyDown(document, { key: 'j' });
    expect(selectedRow()).toHaveTextContent('A oldest');
    expect(a).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'j' });
    expect(a).toHaveAttribute('aria-expanded', 'false');
    expect(b).toHaveAttribute('aria-expanded', 'true');

    // Back up lands on the previous conversation's header, which opens it again.
    fireEvent.keyDown(document, { key: 'k' });
    expect(a).toHaveAttribute('aria-expanded', 'true');
    expect(b).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(a).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives a selected header no verbs — they belong to its messages', async () => {
    const user = userEvent.setup();
    renderView(potluck());
    await openShelf(user);

    fireEvent.keyDown(document, { key: 'j' });
    expect(header(/3 messages/)).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 't' });
    fireEvent.keyDown(document, { key: 'x' });
    fireEvent.keyDown(document, { key: 'i' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(jest.mocked(api).clearCommMessage).not.toHaveBeenCalled();
    expect(jest.mocked(api).changeCommTier).not.toHaveBeenCalled();
  });

  it('loses just the promoted message, and draws a conversation left with one as a plain row', async () => {
    const user = userEvent.setup();
    const [newer, older] = thread('pair', [
      { sender_name: 'Mom', body: 'Gutters are done' },
      { sender_name: 'Mom', body: 'Morning!' },
    ]) as [CommMessage, CommMessage];
    jest.mocked(api).changeCommTier.mockResolvedValue({ ...newer, tier: 'today' });
    renderView([newer, older]);
    await openShelf(user);

    const pair = header(/2 messages/);
    await user.click(pair);
    await user.click(within(messageList(pair)).getByText('Gutters are done', { selector: 'p' }));
    await user.click(screen.getByRole('button', { name: /Change tier/ }));
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    const collapsed = new Event('transitionend', { bubbles: true });
    Object.defineProperty(collapsed, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(selectedRowCollapse(), collapsed);

    expect(await screen.findByLabelText('1 in Today')).toBeInTheDocument();
    expect(screen.queryByTestId('comms-conversation')).not.toBeInTheDocument();
    const remaining = screen.getByText('Morning!', { selector: 'p' });
    expect(remaining.closest('[data-testid="comms-row"]')).not.toBeNull();
  });
});
