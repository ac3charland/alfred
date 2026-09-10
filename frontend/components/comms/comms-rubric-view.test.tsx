import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as apiClient from '@/lib/api-client';
import { makeCommRubric, resetCommFixtureClock } from '@/lib/comms/fixtures';
import { pinClock } from '@/lib/pin-clock';
import { renderWithProviders } from '@/lib/test-utils';
import type { CommRubric } from '@/lib/types';

import { CommsRubricView } from './comms-rubric-view';

jest.mock('@/lib/api-client');

// "saved 3h ago" is a comparison against now, so the clock is pinned rather than asserted around.
pinClock('2026-07-28T12:00:00.000Z');

const mockCreateRubric = jest.mocked(apiClient.createCommRubricVersion);

const V1 = makeCommRubric('Anything from my wife is ASAP.', {
  version: 1,
  created_at: '2026-07-01T09:00:00.000Z',
});
const V2 = makeCommRubric('Anything from my wife is ASAP.\nInvoices go to Today.', {
  version: 2,
  created_at: '2026-07-28T09:00:00.000Z',
});

beforeEach(() => {
  resetCommFixtureClock();
});

function renderView(rubrics: CommRubric[]) {
  return renderWithProviders(<CommsRubricView />, { commsSettings: { rubrics } });
}

describe('CommsRubricView', () => {
  it('offers three example lines when no rubric has ever been written', () => {
    renderView([]);

    expect(screen.getByLabelText('Rubric')).toHaveAttribute(
      'placeholder',
      expect.stringContaining('Anything from my wife is ASAP.'),
    );
    expect(screen.getByText(/No version saved yet/)).toBeInTheDocument();
  });

  it('opens on the current version’s text, and says which version and when', () => {
    renderView([V2, V1]);

    expect(screen.getByLabelText('Rubric')).toHaveValue(V2.body);
    expect(screen.getByText('Version 2 · saved 3h ago')).toBeInTheDocument();
  });

  it('states that saving re-judges nothing, where the save happens', () => {
    renderView([V2, V1]);
    expect(
      screen.getByText(/Every message already judged keeps the verdict it was given/),
    ).toBeInTheDocument();
  });

  it('refuses to save text identical to the version already stored', () => {
    renderView([V2, V1]);
    expect(screen.getByRole('button', { name: 'Save new version' })).toBeDisabled();
  });

  it('saves an edit as a new version, and shows the number the server gave it', async () => {
    const user = userEvent.setup();
    const v3 = makeCommRubric('Recruiters are never urgent.', {
      version: 3,
      created_at: '2026-07-28T12:00:00.000Z',
    });
    mockCreateRubric.mockResolvedValue(v3);
    renderView([V2, V1]);

    const field = screen.getByLabelText('Rubric');
    await user.clear(field);
    await user.type(field, 'Recruiters are never urgent.');
    await user.click(screen.getByRole('button', { name: 'Save new version' }));

    expect(mockCreateRubric).toHaveBeenCalledWith({ body: 'Recruiters are never urgent.' });
    expect(await screen.findByText(/Version 3 · saved/)).toBeInTheDocument();
  });

  it('restores an old version into the editor — and saving it still writes a NEW version', async () => {
    const user = userEvent.setup();
    const v3 = makeCommRubric(V1.body, { version: 3, created_at: '2026-07-28T12:00:00.000Z' });
    mockCreateRubric.mockResolvedValue(v3);
    renderView([V2, V1]);

    await user.click(screen.getByRole('button', { name: 'Previous versions (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(screen.getByLabelText('Rubric')).toHaveValue(V1.body);

    await user.click(screen.getByRole('button', { name: 'Save new version' }));

    expect(mockCreateRubric).toHaveBeenCalledWith({ body: V1.body });
    expect(await screen.findByText(/Version 3 · saved/)).toBeInTheDocument();
  });

  it('hides the history entirely when there is only ever been one version', () => {
    renderView([V1]);
    expect(screen.queryByText(/Previous versions/)).not.toBeInTheDocument();
  });

  it('reverts an unsaved edit back to the stored text', async () => {
    const user = userEvent.setup();
    renderView([V2, V1]);

    const field = screen.getByLabelText('Rubric');
    await user.type(field, ' and again');
    await user.click(screen.getByRole('button', { name: 'Revert' }));

    expect(screen.getByLabelText('Rubric')).toHaveValue(V2.body);
  });

  it('ticks a single clock for the whole view, not one per child', () => {
    // `comms-format.ts` names the convention: the view owns one ticking instant and hands the
    // same one to every consumer — `useNow`'s interval is the only thing in the tree that calls
    // `setInterval`, so one subscription per mount is the signature of that being followed.
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    renderView([V2, V1]);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
