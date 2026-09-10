import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';
import type { CommAccount, CommMessage } from '@/lib/types';

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
