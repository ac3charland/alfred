import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeCommAccount, makeCommMessage, makeCommVerdict } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';
import type { CommAccount, CommMessage, CommPersonWithHandles, CommVerdict } from '@/lib/types';

import { MessageRow } from './message-row';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

/**
 * The row is where the module stops being a report. What is pinned here is that each verb sends
 * the write it claims to — the two clearing verbs in particular, since they are two verbs
 * precisely because only one of them teaches the classifier anything.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const GMAIL: CommAccount = makeCommAccount('RealPlay', {
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'gmail',
});

const DANA: CommPersonWithHandles = {
  id: 'p-dana',
  name: 'Dana Whitfield',
  priority: 'high',
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  comm_handles: [
    {
      id: 'h-dana',
      person_id: 'p-dana',
      handle: 'dana@realplay.example',
      kind: 'email',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
};

function makeRow(overrides: Partial<CommMessage> = {}): CommMessage {
  return makeCommMessage(GMAIL.id, {
    id: '00000000-0000-4000-8000-0000000000b1',
    sender_handle: 'dana@realplay.example',
    sender_name: 'Dana W.',
    subject: 'Q3 invoice',
    body: 'Can you approve the Q3 invoice before the 5pm billing run?',
    ask: 'Needs the Q3 invoice approved before the 5pm billing run.',
    tier: 'asap',
    judged_by: 'model',
    rfc822_message_id: '<invoice-99@realplay.example>',
    received_at: new Date(2026, 8, 9, 9, 14).toISOString(),
    ...overrides,
  });
}

function renderRow({
  message = makeRow(),
  people = [DANA],
  verdict,
  selected = false,
  shelved = false,
  onSelect = jest.fn(),
  account = GMAIL,
}: {
  message?: CommMessage;
  people?: CommPersonWithHandles[];
  verdict?: CommVerdict;
  selected?: boolean;
  shelved?: boolean;
  onSelect?: (id: string | null) => void;
  account?: CommAccount;
} = {}) {
  return renderWithProviders(
    <MessageRow
      message={message}
      account={account}
      accountLabel={account.label}
      people={people}
      verdict={verdict}
      now={NOW}
      selected={selected}
      onSelect={onSelect}
      onAddSender={jest.fn()}
      shelved={shelved}
    />,
    { comms: { accounts: [GMAIL], messages: [message] } },
  );
}

/**
 * jsdom runs no CSS transitions, so the collapse that commits a cleared row's mutation never
 * ends on its own — fire the wrapper's own `grid-template-rows` transitionend by hand.
 */
function endExit(): void {
  const wrapper = screen.getByTestId('comms-row-collapse');
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
  fireEvent(wrapper, event);
}

beforeEach(() => {
  mockApi.clearCommMessage.mockResolvedValue(makeRow());
  mockApi.changeCommTier.mockResolvedValue(makeRow());
  mockApi.requestReclassify.mockResolvedValue(makeRow());
  mockApi.makeInboxItemFromMessage.mockResolvedValue({
    message: makeRow(),
    item: { id: 'item-1' } as never,
  });
});

describe('MessageRow — what a collapsed row says', () => {
  it('leads with the roster name, the account and the arrival time', () => {
    renderRow();

    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument();
    // The exact string, because the expanded detail carries the same account and time
    // prefixed by the sender's handle.
    expect(screen.getByText('· RealPlay · 09:14')).toBeInTheDocument();
  });

  it('leads with the ask, not the subject', () => {
    renderRow();

    expect(
      screen.getByText('Needs the Q3 invoice approved before the 5pm billing run.'),
    ).toBeInTheDocument();
  });

  it('marks a priority sender', () => {
    renderRow();

    expect(screen.getByText('Priority person')).toBeInTheDocument();
  });

  it('marks a row nothing judged', () => {
    renderRow({ message: makeRow({ judged_by: 'unjudged', tier: 'today' }), people: [] });

    expect(screen.getByText('Unjudged')).toBeInTheDocument();
  });

  it('marks an attachment it could not read', () => {
    renderRow({ message: makeRow({ body: '', has_attachments: true }), people: [] });

    expect(screen.getByText('Attachment · not read')).toBeInTheDocument();
  });

  it('marks a row inside its last week', () => {
    const received = new Date(NOW.getTime() - 55 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000);
    renderRow({ message: makeRow({ received_at: received.toISOString() }), people: [] });

    expect(screen.getByText('Deleted in 5 days')).toBeInTheDocument();
  });

  it('keeps the refused and filtered chips to the shelf', () => {
    renderRow({
      message: makeRow({ judged_by: 'refusal', tier: 'fyi', filtered_reason: 'newsletter' }),
      people: [],
      shelved: true,
    });

    expect(screen.getByText('Refused')).toBeInTheDocument();
    expect(screen.getByText('Filtered')).toBeInTheDocument();
  });

  it('hides the detail until the row is selected', () => {
    renderRow();

    expect(screen.queryByRole('button', { name: 'Nothing to answer' })).not.toBeInTheDocument();
  });
});

describe('MessageRow — selection', () => {
  it('selects on click and deselects on a second click', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const { rerender } = renderRow({ onSelect });

    await user.click(screen.getByRole('button', { expanded: false }));
    expect(onSelect).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000b1');

    onSelect.mockClear();
    rerender(
      <MessageRow
        message={makeRow()}
        account={GMAIL}
        accountLabel="RealPlay"
        people={[DANA]}
        verdict={undefined}
        now={NOW}
        selected
        onSelect={onSelect}
        onAddSender={jest.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { expanded: true }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('MessageRow — the expanded detail', () => {
  it('shows the message, its handle and the verdict’s reason', () => {
    renderRow({
      selected: true,
      verdict: makeCommVerdict('m1', { reason: 'Dana is on the roster and named a deadline.' }),
    });

    expect(screen.getByText('Q3 invoice')).toBeInTheDocument();
    expect(screen.getByText(/dana@realplay\.example · RealPlay · 09:14/)).toBeInTheDocument();
    expect(
      screen.getByText('Can you approve the Q3 invoice before the 5pm billing run?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dana is on the roster and named a deadline\./)).toBeInTheDocument();
  });

  it('offers all five verbs on a queued row', () => {
    renderRow({ selected: true });

    expect(screen.getByRole('link', { name: /Open in Mail/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make an Inbox item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nothing to answer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not replying' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change tier/ })).toBeInTheDocument();
  });

  it('builds the Apple Mail link from the captured Message-ID', () => {
    renderRow({ selected: true });

    expect(screen.getByRole('link', { name: /Open in Mail/ })).toHaveAttribute(
      'href',
      'message://%3Cinvoice-99@realplay.example%3E',
    );
  });

  it('disables the link, with a reason, when the row carries no Message-ID', () => {
    renderRow({ selected: true, message: makeRow({ rfc822_message_id: null }) });

    const button = screen.getByRole('button', { name: /Open in Mail/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('No Message-ID'));
  });

  it('offers only the source link and the tier picker on the shelf', () => {
    renderRow({ selected: true, shelved: true, message: makeRow({ tier: 'fyi' }) });

    expect(screen.getByRole('link', { name: /Open in Mail/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change tier/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nothing to answer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make an Inbox item' })).not.toBeInTheDocument();
  });
});

describe('MessageRow — the verbs', () => {
  it('records a demotion when the row asked nothing', async () => {
    const user = userEvent.setup();
    renderRow({ selected: true });

    await user.click(screen.getByRole('button', { name: 'Nothing to answer' }));
    endExit();

    expect(mockApi.clearCommMessage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000b1',
      'nothing_to_answer',
    );
  });

  it('records nothing when the owner is simply not replying', async () => {
    const user = userEvent.setup();
    renderRow({ selected: true });

    await user.click(screen.getByRole('button', { name: 'Not replying' }));
    endExit();

    expect(mockApi.clearCommMessage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000b1',
      'not_replying',
    );
  });

  it('waits for the row to collapse before it commits', async () => {
    const user = userEvent.setup();
    renderRow({ selected: true });

    await user.click(screen.getByRole('button', { name: 'Not replying' }));

    expect(mockApi.clearCommMessage).not.toHaveBeenCalled();
  });

  it('spins the obligation into an Inbox item', async () => {
    const user = userEvent.setup();
    renderRow({ selected: true });

    await user.click(screen.getByRole('button', { name: 'Make an Inbox item' }));
    endExit();

    expect(mockApi.makeInboxItemFromMessage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000b1',
    );
  });

  it('asks for a re-run without moving the row', async () => {
    const user = userEvent.setup();
    renderRow({ selected: true });

    await user.click(screen.getByRole('button', { name: /Re-run classifier/ }));

    expect(mockApi.requestReclassify).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000b1');
  });

  it('moves the row through the tier menu, and marks the tier it is in now', async () => {
    const user = userEvent.setup();
    renderRow({ selected: true });

    await user.click(screen.getByRole('button', { name: /Change tier/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'ASAP' })).toHaveAttribute(
      'data-current',
      'true',
    );

    // Radix sets `pointer-events: none` on the body while a menu is open, so a portalled item is
    // reached by keyboard rather than by click.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    endExit();

    expect(mockApi.changeCommTier).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000b1',
      'today',
    );
  });
});

describe('MessageRow — hotkeys on the selected row', () => {
  it('clears with n, and only while the row is selected', () => {
    const { rerender } = renderRow({ selected: false });

    fireEvent.keyDown(document, { key: 'n' });
    expect(mockApi.clearCommMessage).not.toHaveBeenCalled();

    rerender(
      <MessageRow
        message={makeRow()}
        account={GMAIL}
        accountLabel="RealPlay"
        people={[DANA]}
        verdict={undefined}
        now={NOW}
        selected
        onSelect={jest.fn()}
        onAddSender={jest.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'n' });
    endExit();

    expect(mockApi.clearCommMessage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000b1',
      'nothing_to_answer',
    );
  });

  it('clears with x', () => {
    renderRow({ selected: true });

    fireEvent.keyDown(document, { key: 'x' });
    endExit();

    expect(mockApi.clearCommMessage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-0000000000b1',
      'not_replying',
    );
  });

  it('makes an Inbox item with i', () => {
    renderRow({ selected: true });

    fireEvent.keyDown(document, { key: 'i' });
    endExit();

    expect(mockApi.makeInboxItemFromMessage).toHaveBeenCalled();
  });

  it('opens the tier menu with t', async () => {
    renderRow({ selected: true });

    fireEvent.keyDown(document, { key: 't' });

    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('opens the source link with o', () => {
    renderRow({ selected: true });
    const link = screen.getByRole('link', { name: /Open in Mail/ });
    const click = jest.spyOn(link, 'click').mockImplementation(() => {});

    fireEvent.keyDown(document, { key: 'o' });

    expect(click).toHaveBeenCalled();
  });

  it('leaves the clearing verbs alone on a shelf row', () => {
    renderRow({ selected: true, shelved: true, message: makeRow({ tier: 'fyi' }) });

    fireEvent.keyDown(document, { key: 'n' });
    fireEvent.keyDown(document, { key: 'x' });
    fireEvent.keyDown(document, { key: 'i' });

    expect(mockApi.clearCommMessage).not.toHaveBeenCalled();
    expect(mockApi.makeInboxItemFromMessage).not.toHaveBeenCalled();
  });

  it('ignores a verb key typed into a field', () => {
    renderRow({ selected: true });
    const field = document.createElement('input');
    document.body.append(field);

    fireEvent.keyDown(field, { key: 'n' });

    expect(mockApi.clearCommMessage).not.toHaveBeenCalled();
    field.remove();
  });
});
