import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { copyToClipboard } from '@/lib/clipboard';
import {
  makeReaderCandidate,
  makeReaderPublication,
  makeReaderPublicationListItem,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type { ReaderCandidate, ReaderPublicationListItem } from '@/lib/types';

import {
  ReaderSettingsProvider,
  readerSettingsReducer,
  useReaderCandidates,
  useReaderPublications,
  useReaderSettingsActions,
} from './reader-settings-store';

// A factory mock rather than a bare `jest.mock('@/lib/api-client')`: automocking would replace
// `ApiError` with a mock constructor whose real assignments (`status`, `detail`) never run,
// which is exactly what `addCandidate`'s 409 detection reads. `requireActual` keeps the real
// class and every other export; only the two functions this store calls are overridden.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  createReaderPublication: jest.fn(),
  updateReaderPublication: jest.fn(),
  fetchReaderPublications: jest.fn(),
}));
jest.mock('@/lib/clipboard');

const mockCreateReaderPublication = jest.mocked(apiClient.createReaderPublication);
const mockUpdateReaderPublication = jest.mocked(apiClient.updateReaderPublication);
const mockFetchReaderPublications = jest.mocked(apiClient.fetchReaderPublications);
const mockCopyToClipboard = jest.mocked(copyToClipboard);

// Capture showToast so a rollback/failure test can assert the message a failed write surfaces.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

const PUBLICATION = makeReaderPublicationListItem('Second Thoughts', {
  id: '00000000-0000-4000-8000-000000000001',
  last_post_at: '2026-09-10T12:00:00.000Z',
});
const CANDIDATE = makeReaderCandidate('news@example.com', { name: 'Example Weekly' });

function makeWrapper(
  publications: ReaderPublicationListItem[],
  candidates: ReaderCandidate[] = [],
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ReaderSettingsProvider initialPublications={publications} initialCandidates={candidates}>
        {children}
      </ReaderSettingsProvider>
    );
  };
}

function useStore() {
  return {
    publications: useReaderPublications(),
    candidates: useReaderCandidates(),
    actions: useReaderSettingsActions(),
  };
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('readerSettingsReducer', () => {
  it('patches a publication by id', () => {
    const next = readerSettingsReducer(
      { publications: [PUBLICATION], candidates: [] },
      {
        type: 'publications',
        action: { type: 'patch', ids: [PUBLICATION.id], patch: { enabled: false } },
      },
    );

    expect(next.publications[0]?.enabled).toBe(false);
  });

  it('is a no-op for a publication patch naming an id it no longer holds', () => {
    const state = { publications: [PUBLICATION], candidates: [] };

    const next = readerSettingsReducer(state, {
      type: 'publications',
      action: { type: 'patch', ids: ['gone'], patch: { enabled: false } },
    });

    expect(next.publications).toEqual(state.publications);
  });

  it('removes a candidate by its handle, which is the only identity it has', () => {
    const next = readerSettingsReducer(
      { publications: [], candidates: [CANDIDATE, makeReaderCandidate('other@example.com')] },
      { type: 'candidates', action: { type: 'remove', ids: ['news@example.com'] } },
    );

    expect(next.candidates.map((row) => row.handle)).toEqual(['other@example.com']);
  });

  it('leaves the other list alone on either action', () => {
    const state = { publications: [PUBLICATION], candidates: [CANDIDATE] };

    const afterPublication = readerSettingsReducer(state, {
      type: 'publications',
      action: { type: 'remove', ids: [PUBLICATION.id] },
    });
    const afterCandidate = readerSettingsReducer(state, {
      type: 'candidates',
      action: { type: 'remove', ids: [CANDIDATE.handle] },
    });

    expect(afterPublication.candidates).toBe(state.candidates);
    expect(afterCandidate.publications).toBe(state.publications);
  });

  it('throws on an action it does not know, naming the store', () => {
    expect(() =>
      readerSettingsReducer({ publications: [], candidates: [] }, {
        type: 'nonsense',
      } as never),
    ).toThrow('Unhandled reader settings action');
  });
});

describe('ReaderSettingsProvider', () => {
  it('serves the seeded roster and candidates', () => {
    const { result } = renderHook(() => useStore(), {
      wrapper: makeWrapper([PUBLICATION], [CANDIDATE]),
    });

    expect(result.current.publications).toEqual([PUBLICATION]);
    expect(result.current.candidates).toEqual([CANDIDATE]);
  });

  it('throws when a hook is used outside the provider', () => {
    // React logs the error boundary trace; the assertion is on the throw itself.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useReaderPublications())).toThrow(
      'useReaderPublications must be used within a ReaderSettingsProvider',
    );

    consoleError.mockRestore();
  });

  it('rejects an edit to a publication the store does not hold', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

    await expect(result.current.actions.setEnabled('gone', false)).rejects.toThrow(
      'No publication gone',
    );
  });

  describe('setEnabled', () => {
    it('pauses at once and reconciles with the stored row', async () => {
      mockUpdateReaderPublication.mockResolvedValue(
        makeReaderPublication('Second Thoughts', { id: PUBLICATION.id, enabled: false }),
      );
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

      await act(async () => {
        await result.current.actions.setEnabled(PUBLICATION.id, false);
      });

      expect(mockUpdateReaderPublication).toHaveBeenCalledWith(PUBLICATION.id, { enabled: false });
      expect(result.current.publications[0]).toMatchObject({ enabled: false });
    });

    it('rolls back and toasts when the write fails', async () => {
      mockUpdateReaderPublication.mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

      await act(async () => {
        await expect(result.current.actions.setEnabled(PUBLICATION.id, false)).rejects.toThrow(
          'boom',
        );
      });

      expect(result.current.publications[0]?.enabled).toBe(true);
      expect(mockShowToast).toHaveBeenCalledWith("Couldn't update that publication");
    });
  });

  describe('rename and setNotes', () => {
    it('persist the returned row and keep last_post_at, which the write never carries', async () => {
      mockUpdateReaderPublication.mockResolvedValue(
        makeReaderPublication('Renamed', { id: PUBLICATION.id }),
      );
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

      await act(async () => {
        await result.current.actions.rename(PUBLICATION.id, 'Renamed');
      });

      expect(result.current.publications[0]).toMatchObject({
        name: 'Renamed',
        last_post_at: PUBLICATION.last_post_at,
      });
    });

    it('sets and then clears a note', async () => {
      mockUpdateReaderPublication.mockResolvedValueOnce(
        makeReaderPublication('Second Thoughts', { id: PUBLICATION.id, notes: 'why this one' }),
      );
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

      await act(async () => {
        await result.current.actions.setNotes(PUBLICATION.id, 'why this one');
      });
      expect(result.current.publications[0]).toMatchObject({ notes: 'why this one' });

      mockUpdateReaderPublication.mockResolvedValueOnce(
        makeReaderPublication('Second Thoughts', { id: PUBLICATION.id, notes: null }),
      );
      await act(async () => {
        await result.current.actions.setNotes(PUBLICATION.id, null);
      });
      expect(result.current.publications[0]).toMatchObject({ notes: null });
    });

    it('rolls back and toasts when the write fails', async () => {
      mockUpdateReaderPublication.mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

      await act(async () => {
        await expect(result.current.actions.rename(PUBLICATION.id, 'Renamed')).rejects.toThrow(
          'boom',
        );
      });

      expect(result.current.publications[0]?.name).toBe(PUBLICATION.name);
      expect(mockShowToast).toHaveBeenCalledWith("Couldn't save that publication");
    });
  });

  describe('addCandidate', () => {
    it('moves the promoted row from candidates to the roster', async () => {
      const saved = makeReaderPublication('news', {
        id: '00000000-0000-4000-8000-000000000099',
        handle: CANDIDATE.handle,
        source: 'owner',
      });
      mockCreateReaderPublication.mockResolvedValue(saved);
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([], [CANDIDATE]) });

      await act(async () => {
        await result.current.actions.addCandidate(CANDIDATE.handle);
      });

      // The display name the candidate row showed rides along, so the card it becomes reads the
      // same rather than falling back to the handle's local part.
      expect(mockCreateReaderPublication).toHaveBeenCalledWith({
        handle: CANDIDATE.handle,
        name: CANDIDATE.name,
      });
      expect(result.current.publications).toEqual([{ ...saved, last_post_at: null }]);
      expect(result.current.candidates).toEqual([]);
    });

    it('sends no name for a sender that has never set one, leaving the route its fallback', async () => {
      const nameless = makeReaderCandidate('quiet@example.com');
      mockCreateReaderPublication.mockResolvedValue(
        makeReaderPublication('quiet', {
          id: '00000000-0000-4000-8000-00000000009a',
          handle: nameless.handle,
          source: 'owner',
        }),
      );
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([], [nameless]) });

      await act(async () => {
        await result.current.actions.addCandidate(nameless.handle);
      });

      expect(mockCreateReaderPublication).toHaveBeenCalledWith({ handle: nameless.handle });
    });

    it('keeps the roster in name order after a promotion appends to it', async () => {
      const zed = makeReaderPublicationListItem('Zed Letter', {
        id: '00000000-0000-4000-8000-00000000009b',
      });
      mockCreateReaderPublication.mockResolvedValue(
        makeReaderPublication('Aardvark Weekly', {
          id: '00000000-0000-4000-8000-00000000009c',
          handle: CANDIDATE.handle,
          source: 'owner',
        }),
      );
      const { result } = renderHook(() => useStore(), {
        wrapper: makeWrapper([zed], [CANDIDATE]),
      });

      await act(async () => {
        await result.current.actions.addCandidate(CANDIDATE.handle);
      });

      expect(result.current.publications.map((row) => row.name)).toEqual([
        'Aardvark Weekly',
        'Zed Letter',
      ]);
    });

    it('toasts a friendly message on a duplicate handle (409), drops the stale candidate, and refreshes the roster so the sender lands there', async () => {
      const error = new apiClient.ApiError('API POST failed: 409', 409, 'duplicate key');
      mockCreateReaderPublication.mockRejectedValue(error);
      // The row this rejected attempt would have created already exists server-side (that is
      // what the 409 means) — the refetch is what surfaces it locally.
      const existing = makeReaderPublicationListItem('Example Weekly', {
        id: '00000000-0000-4000-8000-0000000000aa',
        handle: CANDIDATE.handle,
      });
      mockFetchReaderPublications.mockResolvedValue([existing]);
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([], [CANDIDATE]) });

      await act(async () => {
        await expect(result.current.actions.addCandidate(CANDIDATE.handle)).rejects.toThrow();
      });

      expect(mockShowToast).toHaveBeenCalledWith('That sender is already a publication');
      // The server just said this handle is already a publication, so the stale row in the
      // local candidates list — the roster read just hasn't caught up yet — is dropped rather
      // than left to 409 again on a second click.
      expect(result.current.candidates).toEqual([]);
      // …and the sender is not simply dropped on the floor: the roster refetch upserts the row
      // that already exists for it, so it appears in the roster rather than in neither list.
      expect(result.current.publications).toEqual([existing]);
    });

    it('leaves the roster untouched, silently, when the post-409 refresh itself fails', async () => {
      const error = new apiClient.ApiError('API POST failed: 409', 409, 'duplicate key');
      mockCreateReaderPublication.mockRejectedValue(error);
      mockFetchReaderPublications.mockRejectedValue(new Error('network down'));
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([], [CANDIDATE]) });

      await act(async () => {
        await expect(result.current.actions.addCandidate(CANDIDATE.handle)).rejects.toThrow();
      });

      // The 409 toast is still the only message shown — a failed background refresh gets no
      // toast of its own, since the user already has the answer to what they asked for.
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('That sender is already a publication');
      expect(result.current.candidates).toEqual([]);
      expect(result.current.publications).toEqual([]);
    });

    it('toasts a generic message on any other failure', async () => {
      mockCreateReaderPublication.mockRejectedValue(new Error('network down'));
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([], [CANDIDATE]) });

      await act(async () => {
        await expect(result.current.actions.addCandidate(CANDIDATE.handle)).rejects.toThrow();
      });

      expect(mockShowToast).toHaveBeenCalledWith("Couldn't add that publication");
    });

    it('rejects promoting a candidate the store does not hold', async () => {
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([], []) });

      await expect(result.current.actions.addCandidate('gone@example.com')).rejects.toThrow(
        'No candidate gone@example.com',
      );
    });
  });

  describe('copyFilterQuery', () => {
    it('copies the sorted, enabled-only handles and toasts success', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const publications = [
        makeReaderPublicationListItem('B', { handle: 'b@example.com', enabled: true }),
        makeReaderPublicationListItem('A', { handle: 'a@example.com', enabled: true }),
        makeReaderPublicationListItem('C', { handle: 'c@example.com', enabled: false }),
      ];
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(publications) });

      await act(async () => {
        await result.current.actions.copyFilterQuery();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith('from:(a@example.com OR b@example.com)');
      expect(mockShowToast).toHaveBeenCalledWith('Gmail filter query copied');
    });

    it('toasts a failure when the clipboard is unavailable', async () => {
      mockCopyToClipboard.mockResolvedValue(false);
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([PUBLICATION]) });

      await act(async () => {
        await result.current.actions.copyFilterQuery();
      });

      expect(mockShowToast).toHaveBeenCalledWith("Couldn't copy — clipboard unavailable");
    });

    it('resolves without copying, and with no toast, when nothing is enabled', async () => {
      const { result } = renderHook(() => useStore(), {
        wrapper: makeWrapper([makeReaderPublicationListItem('X', { enabled: false })]),
      });

      await act(async () => {
        await result.current.actions.copyFilterQuery();
      });

      expect(mockCopyToClipboard).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    });
  });
});
