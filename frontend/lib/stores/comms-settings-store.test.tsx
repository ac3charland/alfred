import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import {
  makeCommCorrection,
  makeCommHandle,
  makeCommPerson,
  makeCommRubric,
  resetCommFixtureClock,
} from '@/lib/comms/fixtures';
import type { CommCorrection, CommPersonWithHandles, CommRubric } from '@/lib/types';

import {
  CommsSettingsProvider,
  commsSettingsReducer,
  useCommsExamples,
  useCommsPeople,
  useCommsRubrics,
  useCommsSettingsActions,
  useCurrentRubric,
} from './comms-settings-store';

jest.mock('@/lib/api-client');

const mockCreatePerson = jest.mocked(apiClient.createCommPerson);
const mockUpdatePerson = jest.mocked(apiClient.updateCommPerson);
const mockDeletePerson = jest.mocked(apiClient.deleteCommPerson);
const mockAddHandle = jest.mocked(apiClient.addCommHandle);
const mockDeleteHandle = jest.mocked(apiClient.deleteCommHandle);
const mockCreateRubric = jest.mocked(apiClient.createCommRubricVersion);
const mockPruneExample = jest.mocked(apiClient.pruneCommExample);

// Capture showToast so the rollback test can assert the message a failed write surfaces.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

beforeEach(() => {
  resetCommFixtureClock();
  jest.clearAllMocks();
});

/** A roster person carrying the handles that resolve to them. */
function person(name: string, handles: string[] = []): CommPersonWithHandles {
  const row = makeCommPerson(name);
  return { ...row, comm_handles: handles.map((handle) => makeCommHandle(row.id, handle)) };
}

describe('commsSettingsReducer', () => {
  const empty = { people: [], rubrics: [], corrections: [] };

  it('upserts, patches and removes roster rows', () => {
    const dana = person('Dana Whitfield', ['dana@example.com']);
    const added = commsSettingsReducer(empty, {
      type: 'people',
      action: { type: 'upsert', items: [dana] },
    });
    expect(added.people).toHaveLength(1);

    const renamed = commsSettingsReducer(added, {
      type: 'people',
      action: { type: 'patch', ids: [dana.id], patch: { name: 'Dana W.' } },
    });
    expect(renamed.people[0]?.name).toBe('Dana W.');

    const removed = commsSettingsReducer(renamed, {
      type: 'people',
      action: { type: 'remove', ids: [dana.id] },
    });
    expect(removed.people).toEqual([]);
  });

  it('puts a saved rubric at the HEAD, so it becomes the current version', () => {
    const first = makeCommRubric('Answer things people ask you.', { version: 1 });
    const second = makeCommRubric('Answer things people ask you, promptly.', { version: 2 });

    const seeded = { ...empty, rubrics: [first] };
    const saved = commsSettingsReducer(seeded, { type: 'addRubric', rubric: second });

    expect(saved.rubrics.map((rubric) => rubric.version)).toEqual([2, 1]);
  });

  it('never lists the same rubric version twice when a save is applied again', () => {
    const rubric = makeCommRubric('Be responsive.', { version: 3 });
    const once = commsSettingsReducer(empty, { type: 'addRubric', rubric });
    const twice = commsSettingsReducer(once, { type: 'addRubric', rubric });

    expect(twice.rubrics).toHaveLength(1);
  });

  it('is a no-op for a correction patch naming an id it no longer holds', () => {
    const state = commsSettingsReducer(empty, {
      type: 'corrections',
      action: { type: 'patch', ids: ['gone'], patch: { pruned_at: 'now' } },
    });
    expect(state.corrections).toEqual([]);
  });
});

// ── selectors + actions, through a real provider ────────────────────────────

const DANA = person('Dana Whitfield', ['dana@example.com']);
const OLD_RUBRIC = makeCommRubric('Answer things people ask you.', { version: 1 });
const NEW_RUBRIC = makeCommRubric('Answer things people ask you, promptly.', { version: 2 });
const EXAMPLE = makeCommCorrection({ chosen_tier: 'whenever' });

function useStore() {
  return {
    actions: useCommsSettingsActions(),
    people: useCommsPeople(),
    rubrics: useCommsRubrics(),
    current: useCurrentRubric(),
    examples: useCommsExamples(),
  };
}

function makeWrapper(
  seed: {
    people?: CommPersonWithHandles[];
    rubrics?: CommRubric[];
    corrections?: CommCorrection[];
  } = {},
): React.FC<{ children: React.ReactNode }> {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CommsSettingsProvider
        initialPeople={seed.people ?? [DANA]}
        // The seed reader hands them over newest-first, which is what makes the head current.
        initialRubrics={seed.rubrics ?? [NEW_RUBRIC, OLD_RUBRIC]}
        initialCorrections={seed.corrections ?? [EXAMPLE]}
      >
        {children}
      </CommsSettingsProvider>
    );
  };
}

describe('CommsSettingsProvider selectors', () => {
  it('reads the roster, the rubric history and the example set from the seed', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    expect(result.current.people).toHaveLength(1);
    expect(result.current.rubrics).toHaveLength(2);
    expect(result.current.examples).toHaveLength(1);
  });

  it('treats the newest version as the rubric in force', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(result.current.current?.version).toBe(2);
  });

  it('reports no current rubric before one has ever been written', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper({ rubrics: [] }) });
    expect(result.current.current).toBeUndefined();
  });

  it('throws outside a provider, naming the hook that asked', () => {
    expect(() => renderHook(() => useCommsPeople())).toThrow(
      'useCommsPeople must be used within a CommsSettingsProvider',
    );
  });
});

describe('local actions', () => {
  it('adds, patches and removes a person in this tab only', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.upsertPeopleLocally([person('Marcus Okonkwo')]);
    });
    expect(result.current.people.map((row) => row.name)).toEqual([
      'Dana Whitfield',
      'Marcus Okonkwo',
    ]);

    act(() => {
      result.current.actions.patchPersonLocally(DANA.id, { priority: 'low' });
    });
    expect(result.current.people[0]?.priority).toBe('low');

    act(() => {
      result.current.actions.removePersonLocally(DANA.id);
    });
    expect(result.current.people.map((row) => row.name)).toEqual(['Marcus Okonkwo']);
  });

  it('makes a saved rubric version current the moment it lands', () => {
    const third = makeCommRubric('Answer within the day.', { version: 3 });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.addRubricVersion(third);
    });

    expect(result.current.current?.version).toBe(3);
    expect(result.current.rubrics).toHaveLength(3);
  });
});

describe('writeExample', () => {
  const PRUNE = { pruned_at: '2026-02-01T09:00:00.000Z' };

  it('applies the prune immediately and reconciles with the server row', async () => {
    const saved: CommCorrection = { ...EXAMPLE, ...PRUNE, pruned_version: 4 };
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.writeExample(
        EXAMPLE.id,
        PRUNE,
        () => Promise.resolve(saved),
        "Couldn't update that example",
      );
    });

    expect(result.current.examples[0]?.pruned_at).toBe(PRUNE.pruned_at);
    // Reconciled with the whole server row: the version the trigger stamped comes back too.
    expect(result.current.examples[0]?.pruned_version).toBe(4);
  });

  it('restores the captured field, toasts, and re-throws on failure', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.actions.writeExample(
          EXAMPLE.id,
          PRUNE,
          () => Promise.reject(new Error('boom')),
          "Couldn't update that example",
        ),
      ).rejects.toThrow('boom');
    });

    expect(result.current.examples[0]?.pruned_at).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't update that example");
  });
});

describe('writePerson', () => {
  it('applies a roster edit immediately and reconciles with the server row', async () => {
    const saved: CommPersonWithHandles = { ...DANA, name: 'Dana W.', priority: 'normal' };
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.writePerson(
        DANA.id,
        { name: 'Dana W.' },
        () => Promise.resolve(saved),
        "Couldn't save that person",
      );
    });

    expect(result.current.people[0]?.name).toBe('Dana W.');
    expect(result.current.people[0]?.priority).toBe('normal');
  });

  it('restores the captured name and toasts on failure', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.actions.writePerson(
          DANA.id,
          { name: 'Dana W.' },
          () => Promise.reject(new Error('boom')),
          "Couldn't save that person",
        ),
      ).rejects.toThrow('boom');
    });

    expect(result.current.people[0]?.name).toBe('Dana Whitfield');
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't save that person");
  });
});

// ── the API-backed actions ──────────────────────────────────────────────────

describe('createPerson', () => {
  it('puts the saved person — handles and all — into the roster', async () => {
    const marcus = person('Marcus Okonkwo', ['+15550102233']);
    mockCreatePerson.mockResolvedValue(marcus);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.createPerson({
        name: 'Marcus Okonkwo',
        priority: 'high',
        handles: [{ handle: '+1 (555) 010-2233', kind: 'phone' }],
      });
    });

    expect(mockCreatePerson).toHaveBeenCalledWith({
      name: 'Marcus Okonkwo',
      priority: 'high',
      handles: [{ handle: '+1 (555) 010-2233', kind: 'phone' }],
    });
    expect(result.current.people.map((row) => row.name)).toEqual([
      'Dana Whitfield',
      'Marcus Okonkwo',
    ]);
    expect(result.current.people[1]?.comm_handles).toHaveLength(1);
  });

  it('leaves the roster untouched, toasts and re-throws when the write is refused', async () => {
    mockCreatePerson.mockRejectedValue(new Error('409'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.actions.createPerson({ name: 'Marcus', priority: 'high', handles: [] }),
      ).rejects.toThrow('409');
    });

    expect(result.current.people).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      "Couldn't add that person — is a handle already listed?",
    );
  });
});

describe('updatePerson', () => {
  it('shows the new priority at once and reconciles with the row the server returns', async () => {
    mockUpdatePerson.mockResolvedValue({ ...DANA, priority: 'low', notes: 'never urgent' });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.updatePerson(DANA.id, { priority: 'low' });
    });

    expect(mockUpdatePerson).toHaveBeenCalledWith(DANA.id, { priority: 'low' });
    expect(result.current.people[0]?.priority).toBe('low');
    expect(result.current.people[0]?.notes).toBe('never urgent');
  });

  it('restores the priority and toasts when the write fails', async () => {
    mockUpdatePerson.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.actions.updatePerson(DANA.id, { priority: 'low' }),
      ).rejects.toThrow('boom');
    });

    expect(result.current.people[0]?.priority).toBe('high');
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't save that person");
  });
});

describe('deletePerson', () => {
  it('drops the row immediately', async () => {
    mockDeletePerson.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.deletePerson(DANA.id);
    });

    expect(result.current.people).toEqual([]);
  });

  it('brings the person back — handles included — when the delete fails', async () => {
    mockDeletePerson.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.deletePerson(DANA.id)).rejects.toThrow('boom');
    });

    expect(result.current.people[0]?.comm_handles).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't remove that person");
  });
});

describe('addHandle / removeHandle', () => {
  it('appends the handle the server stored, not the one the form sent', async () => {
    const stored = makeCommHandle(DANA.id, '+15550102233', { kind: 'phone' });
    mockAddHandle.mockResolvedValue(stored);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.addHandle(DANA.id, {
        handle: '+1 (555) 010-2233',
        kind: 'phone',
      });
    });

    expect(result.current.people[0]?.comm_handles.map((row) => row.handle)).toEqual([
      'dana@example.com',
      '+15550102233',
    ]);
  });

  it('removes a handle at once and puts it back when the delete fails', async () => {
    mockDeleteHandle.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    const handleId = result.current.people[0]?.comm_handles[0]?.id ?? '';

    await act(async () => {
      await expect(result.current.actions.removeHandle(DANA.id, handleId)).rejects.toThrow('boom');
    });

    expect(result.current.people[0]?.comm_handles).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't remove that handle");
  });

  it('removes the handle when the delete succeeds', async () => {
    mockDeleteHandle.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    const handleId = result.current.people[0]?.comm_handles[0]?.id ?? '';

    await act(async () => {
      await result.current.actions.removeHandle(DANA.id, handleId);
    });

    expect(result.current.people[0]?.comm_handles).toEqual([]);
  });
});

describe('saveRubric', () => {
  it('makes the version the SERVER numbered the current one', async () => {
    const third = makeCommRubric('Answer within the day.', { version: 3 });
    mockCreateRubric.mockResolvedValue(third);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.saveRubric('Answer within the day.');
    });

    expect(mockCreateRubric).toHaveBeenCalledWith({ body: 'Answer within the day.' });
    expect(result.current.current?.version).toBe(3);
    // Nothing is replaced: the older versions a verdict may name are still readable.
    expect(result.current.rubrics).toHaveLength(3);
  });

  it('keeps the current rubric and toasts when the save fails', async () => {
    mockCreateRubric.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.saveRubric('Nope.')).rejects.toThrow('boom');
    });

    expect(result.current.current?.version).toBe(2);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't save the rubric");
  });
});

describe('setExamplePruned', () => {
  it('mutes the example at once and takes the stamped set version from the server', async () => {
    mockPruneExample.mockResolvedValue({
      ...EXAMPLE,
      pruned_at: '2026-02-01T09:00:00.000Z',
      pruned_version: 4,
    });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.setExamplePruned(EXAMPLE.id, true);
    });

    expect(mockPruneExample).toHaveBeenCalledWith(EXAMPLE.id, true);
    expect(result.current.examples[0]?.pruned_version).toBe(4);
  });

  it('clears BOTH prune columns on a restore, so the card can never read half-pruned', async () => {
    const pruned = makeCommCorrection({
      pruned_at: '2026-02-01T09:00:00.000Z',
      pruned_version: 4,
    });
    mockPruneExample.mockResolvedValue({ ...pruned, pruned_at: null, pruned_version: null });
    const { result } = renderHook(() => useStore(), {
      wrapper: makeWrapper({ corrections: [pruned] }),
    });

    await act(async () => {
      await result.current.actions.setExamplePruned(pruned.id, false);
    });

    expect(result.current.examples[0]?.pruned_at).toBeNull();
    expect(result.current.examples[0]?.pruned_version).toBeNull();
  });
});
