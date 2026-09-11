import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as apiClient from '@/lib/api-client';
import { makeCommHandle, makeCommPerson, resetCommFixtureClock } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';
import type { CommPersonWithHandles } from '@/lib/types';

import { CommsPeopleView } from './comms-people-view';

jest.mock('@/lib/api-client');

const mockCreatePerson = jest.mocked(apiClient.createCommPerson);
const mockUpdatePerson = jest.mocked(apiClient.updateCommPerson);
const mockDeletePerson = jest.mocked(apiClient.deleteCommPerson);
const mockAddHandle = jest.mocked(apiClient.addCommHandle);
const mockDeleteHandle = jest.mocked(apiClient.deleteCommHandle);

function person(name: string, handles: string[] = []): CommPersonWithHandles {
  const row = makeCommPerson(name);
  return { ...row, comm_handles: handles.map((handle) => makeCommHandle(row.id, handle)) };
}

let DANA: CommPersonWithHandles;
let MARCUS: CommPersonWithHandles;

beforeEach(() => {
  resetCommFixtureClock();
  DANA = person('Dana Whitfield', ['dana@example.com']);
  MARCUS = person('Marcus Okonkwo', ['+15550102233']);
});

function renderView(people: CommPersonWithHandles[]) {
  return renderWithProviders(<CommsPeopleView />, { commsSettings: { people } });
}

describe('CommsPeopleView', () => {
  it('says what the list is for when nobody is on it', () => {
    renderView([]);
    expect(screen.getByText('No people yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Add the people whose messages should never wait.'),
    ).toBeInTheDocument();
  });

  it('lists people by name — not by when they were added — with their handles', () => {
    renderView([MARCUS, DANA]);

    const names = screen.getAllByRole('button', { name: /^(Dana Whitfield|Marcus Okonkwo)$/ });
    expect(names[0]).toHaveTextContent('Dana Whitfield');
    expect(names[1]).toHaveTextContent('Marcus Okonkwo');
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    expect(screen.getByText('+15550102233')).toBeInTheDocument();
  });

  it('adds a person with a handle, and shows the card the server answered with', async () => {
    const user = userEvent.setup();
    mockCreatePerson.mockResolvedValue(MARCUS);
    renderView([]);

    await user.click(screen.getByRole('button', { name: 'New person' }));
    await user.type(screen.getByLabelText('Name'), 'Marcus Okonkwo');
    await user.click(screen.getByRole('button', { name: 'Phone' }));
    await user.type(screen.getByLabelText('Handle 1'), '+1 (555) 010-2233');
    await user.click(screen.getByRole('button', { name: 'Add person' }));

    expect(mockCreatePerson).toHaveBeenCalledWith({
      name: 'Marcus Okonkwo',
      priority: 'high',
      notes: null,
      handles: [{ handle: '+1 (555) 010-2233', kind: 'phone' }],
    });
    expect(await screen.findByText('+15550102233')).toBeInTheDocument();
  });

  it('keeps an empty handle row out of the create — it is the editor’s scaffolding', async () => {
    const user = userEvent.setup();
    mockCreatePerson.mockResolvedValue(DANA);
    renderView([]);

    await user.click(screen.getByRole('button', { name: 'New person' }));
    await user.type(screen.getByLabelText('Name'), 'Dana Whitfield');
    await user.click(screen.getByRole('button', { name: 'Add person' }));

    expect(mockCreatePerson).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Dana Whitfield', handles: [] }),
    );
  });

  it('changes a priority from the chip, and shows the new one at once', async () => {
    const user = userEvent.setup();
    mockUpdatePerson.mockResolvedValue({ ...DANA, priority: 'low' });
    renderView([DANA]);

    await user.click(screen.getByRole('button', { name: /^Priority for Dana Whitfield/ }));
    await user.click(await screen.findByRole('button', { name: /Never urgent/ }));

    expect(mockUpdatePerson).toHaveBeenCalledWith(DANA.id, { priority: 'low' });
    expect(
      await screen.findByRole('button', { name: 'Priority for Dana Whitfield: Low' }),
    ).toBeInTheDocument();
  });

  it('renames a person in place', async () => {
    const user = userEvent.setup();
    mockUpdatePerson.mockResolvedValue({ ...DANA, name: 'Dana W.' });
    renderView([DANA]);

    await user.click(screen.getByRole('button', { name: 'Dana Whitfield' }));
    const input = screen.getByLabelText('Edit name for Dana Whitfield');
    await user.clear(input);
    await user.type(input, 'Dana W.{Enter}');

    expect(mockUpdatePerson).toHaveBeenCalledWith(DANA.id, { name: 'Dana W.' });
  });

  it('adds a handle to someone already listed', async () => {
    const user = userEvent.setup();
    mockAddHandle.mockResolvedValue(makeCommHandle(DANA.id, 'dana@work.example'));
    renderView([DANA]);

    await user.click(screen.getByRole('button', { name: 'Add handle' }));
    await user.type(
      screen.getByLabelText('New handle for Dana Whitfield'),
      'Dana@Work.example{Enter}',
    );

    expect(mockAddHandle).toHaveBeenCalledWith(DANA.id, {
      handle: 'Dana@Work.example',
      kind: 'email',
    });
    expect(await screen.findByText('dana@work.example')).toBeInTheDocument();
  });

  it('removes a handle at once, and puts it back when the write is refused', async () => {
    const user = userEvent.setup();
    mockDeleteHandle.mockRejectedValue(new Error('boom'));
    renderView([DANA]);

    await user.click(screen.getByRole('button', { name: 'Remove dana@example.com' }));

    await waitFor(() => {
      expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    });
    expect(await screen.findByText("Couldn't remove that handle")).toBeInTheDocument();
  });

  it('removes a person through the confirm, naming what stops resolving', async () => {
    const user = userEvent.setup();
    mockDeletePerson.mockResolvedValue({ success: true });
    renderView([DANA]);

    await user.click(screen.getByRole('button', { name: 'Remove Dana Whitfield' }));
    expect(
      await screen.findByText(/Their 1 handle goes too/, { exact: false }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove person' }));

    expect(mockDeletePerson).toHaveBeenCalledWith(DANA.id);
    await waitFor(() => {
      expect(screen.queryByText('dana@example.com')).not.toBeInTheDocument();
    });
  });
});
