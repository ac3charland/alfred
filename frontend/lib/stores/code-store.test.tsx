import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import {
  CodeProvider,
  HAPPY_PATH_STATES,
  codeItemToStoryPatch,
  isEscapeState,
  useCodeActions,
  useProjectBoard,
  useProjects,
} from './code-store';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCreateProject = jest.mocked(api.createProject);
const mockCreateEpic = jest.mocked(api.createEpic);
const mockEnterCodeModule = jest.mocked(api.enterCodeModule);
const mockCreateCodeStory = jest.mocked(api.createCodeStory);
const mockUpdateCodeState = jest.mocked(api.updateCodeState);
const mockUpdateEpic = jest.mocked(api.updateEpic);
const mockUpdateItem = jest.mocked(api.updateItem);
const mockMoveCodeEpic = jest.mocked(api.moveCodeEpic);

// Capture the realtime UPDATE handler the CodeProvider subscribes, so tests can drive a
// simulated `code_items` change through it without a live Realtime channel. (Overrides the
// no-op stub from jest.setup.ts — a file-level mock wins.)
let mockRealtimeHandler: ((payload: { new: CodeItem }) => void) | undefined;
const mockRemoveChannel = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_event: string, _filter: unknown, handler: (payload: { new: CodeItem }) => void) => {
        mockRealtimeHandler = handler;
        return channel;
      },
      subscribe: () => channel,
    };
    return { channel: () => channel, removeChannel: mockRemoveChannel };
  },
}));

// Capture showToast so the notification tests can assert what (if anything) the handler fires.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

beforeEach(() => {
  mockRealtimeHandler = undefined;
});

const PROJECT_A: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 5,
  created_at: '2025-01-01T00:00:00Z',
};

const PROJECT_B: Project = {
  ...PROJECT_A,
  id: 'p2',
  name: 'Relay',
  key: 'RLP',
  repo_name: 'relay',
  created_at: '2025-01-02T00:00:00Z',
};

function makeEpic(id: string, projectId: string, overrides: Partial<Epic> = {}): Epic {
  return {
    id,
    project_id: projectId,
    name: `Epic ${id}`,
    notes: null,
    ref_number: 1,
    ref: 'ALF-1',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** A saved `epics` row (the PATCH-route response the store reconciles `updateEpic` with). */
function makeSavedEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: 'e1',
    project_id: 'p1',
    name: 'Epic e1',
    notes: null,
    ref_number: 1,
    ref: 'ALF-1',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStory(
  itemId: string,
  epicId: string,
  projectId: string,
  overrides: Partial<CodeStory> = {},
): CodeStory {
  return {
    item_id: itemId,
    project_id: projectId,
    epic_id: epicId,
    ref_number: 1,
    ref: 'ALF-1',
    factory_state: 'needs_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: `Story ${itemId}`,
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: `Epic ${epicId}`,
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    ...overrides,
  };
}

/** Build a saved `code_items` sidecar row (the PATCH-route response the store reconciles). */
function makeSavedSidecar(overrides: Partial<CodeItem> = {}): CodeItem {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
    factory_state: 'in_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-02-02T00:00:00Z',
    ...overrides,
  };
}

/** The live story row for item `i1` wherever it sits on the board (lane or escape bucket). */
function findStory(board: ReturnType<typeof useProjectBoard>): CodeStory | undefined {
  return board.activeEpics
    .flatMap((b) => [...b.lanes.flatMap((l) => l.stories), ...b.escapeStories])
    .find((s) => s.item_id === 'i1');
}

/** The factory_state of item `i1` wherever it sits on the board (lane or escape bucket). */
function findStoryState(board: ReturnType<typeof useProjectBoard>): string | undefined {
  return findStory(board)?.factory_state ?? undefined;
}

/** Drive a simulated `code_items` UPDATE through the captured realtime handler. */
function emitUpdate(row: CodeItem) {
  act(() => {
    mockRealtimeHandler?.({ new: row });
  });
}

/** Override `document.hidden` (jsdom leaves it non-configurable false by default). */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

function makeWrapper(seed: { projects?: Project[]; epics?: Epic[]; stories?: CodeStory[] }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CodeProvider
        initialProjects={seed.projects ?? []}
        initialEpics={seed.epics ?? []}
        initialStories={seed.stories ?? []}
      >
        {children}
      </CodeProvider>
    );
  };
}

/** Read the actions + the derived board for one project in a single hook. */
function useStore(projectId: string) {
  return { actions: useCodeActions(), board: useProjectBoard(projectId) };
}

describe('code-store', () => {
  describe('HAPPY_PATH_STATES', () => {
    it('lists the six happy-path states in board order and excludes the escape states', () => {
      expect([...HAPPY_PATH_STATES]).toEqual([
        'needs_refinement',
        'in_refinement',
        'ready_for_dev',
        'in_development',
        'ready_for_review',
        'done',
      ]);
      expect(HAPPY_PATH_STATES).not.toContain('blocked');
      expect(HAPPY_PATH_STATES).not.toContain('abandoned');
    });
  });

  describe('isEscapeState', () => {
    it('is true only for blocked and abandoned', () => {
      expect(isEscapeState('blocked')).toBe(true);
      expect(isEscapeState('abandoned')).toBe(true);
      expect(isEscapeState('needs_refinement')).toBe(false);
      expect(isEscapeState('done')).toBe(false);
      expect(isEscapeState(null)).toBe(false);
    });
  });

  describe('useProjects', () => {
    it('returns the seeded project list', () => {
      const { result } = renderHook(() => useProjects(), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B] }),
      });
      expect(result.current.map((project) => project.name)).toEqual(['Alfred', 'Relay']);
    });

    it('throws when used outside a CodeProvider', () => {
      // Suppress the expected React error boundary console noise.
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useProjects())).toThrow(/must be used within a CodeProvider/);
      spy.mockRestore();
    });
  });

  describe('useProjectBoard', () => {
    it('resolves the selected project', () => {
      const { result } = renderHook(() => useProjectBoard('p2'), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B] }),
      });
      expect(result.current.project?.name).toBe('Relay');
    });

    it('returns undefined project + empty epics for an unknown project id', () => {
      const { result } = renderHook(() => useProjectBoard('nope'), {
        wrapper: makeWrapper({ projects: [PROJECT_A] }),
      });
      expect(result.current.project).toBeUndefined();
      expect(result.current.activeEpics).toEqual([]);
      expect(result.current.archivedEpics).toEqual([]);
    });

    it('includes only the selected project epics, in seed order', () => {
      const epics = [
        makeEpic('e1', 'p1', { created_at: '2025-01-01T00:00:00Z' }),
        makeEpic('e2', 'p1', { created_at: '2025-01-02T00:00:00Z' }),
        makeEpic('eX', 'p2'),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics }),
      });
      expect(result.current.activeEpics.map((board) => board.epic.id)).toEqual(['e1', 'e2']);
    });

    it('always produces the six happy-path lanes per epic, in order', () => {
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')] }),
      });
      const [board] = result.current.activeEpics;
      expect(board?.lanes.map((lane) => lane.state)).toEqual([...HAPPY_PATH_STATES]);
    });

    it('groups stories into the lane matching their factory_state', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { factory_state: 'needs_refinement' }),
        makeStory('i2', 'e1', 'p1', { factory_state: 'in_development' }),
        makeStory('i3', 'e1', 'p1', { factory_state: 'in_development' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      const [board] = result.current.activeEpics;
      const byState = new Map(board?.lanes.map((lane) => [lane.state, lane.stories]));
      expect(byState.get('needs_refinement')?.map((story) => story.item_id)).toEqual(['i1']);
      expect(byState.get('in_development')?.map((story) => story.item_id)).toEqual(['i2', 'i3']);
      expect(byState.get('done')).toEqual([]);
    });

    it('routes blocked/abandoned stories to escapeStories, not a lane', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { factory_state: 'blocked' }),
        makeStory('i2', 'e1', 'p1', { factory_state: 'abandoned' }),
        makeStory('i3', 'e1', 'p1', { factory_state: 'done' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      const [board] = result.current.activeEpics;
      expect(board?.escapeStories.map((story) => story.item_id)).toEqual(['i1', 'i2']);
      // The escape stories never appear in any happy-path lane.
      const laneItemIds = board?.lanes.flatMap((lane) =>
        lane.stories.map((story) => story.item_id),
      );
      expect(laneItemIds).toEqual(['i3']);
    });

    it('splits archived epics out of the active list', () => {
      const epics = [
        makeEpic('e1', 'p1'),
        makeEpic('e2', 'p1', { archived_at: '2025-02-01T00:00:00Z' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics }),
      });
      expect(result.current.activeEpics.map((board) => board.epic.id)).toEqual(['e1']);
      expect(result.current.archivedEpics.map((board) => board.epic.id)).toEqual(['e2']);
    });
  });

  describe('useCodeActions (optimistic mutations)', () => {
    const SERVER_PROJECT: Project = {
      ...PROJECT_A,
      id: 'server-p',
      name: 'Server project',
      key: 'SRV',
    };

    describe('createProject', () => {
      it('inserts optimistically then reconciles with the saved row', async () => {
        mockCreateProject.mockResolvedValue(SERVER_PROJECT);
        const { result } = renderHook(() => useStore('server-p'), {
          wrapper: makeWrapper({ projects: [] }),
        });

        let returned: Project | undefined;
        await act(async () => {
          returned = await result.current.actions.createProject({
            name: 'Server project',
            github_url: 'https://github.com/ac3charland/srv',
            key: 'SRV',
          });
        });

        expect(returned?.id).toBe('server-p');
        // The reconciled (server) project is in the store, not the temp one.
        expect(result.current.board.project?.name).toBe('Server project');
      });

      it('rolls the optimistic project back out on failure', async () => {
        mockCreateProject.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(
          () => ({ actions: useCodeActions(), projects: useProjects() }),
          {
            wrapper: makeWrapper({ projects: [PROJECT_A] }),
          },
        );

        await act(async () => {
          await expect(
            result.current.actions.createProject({
              name: 'Doomed',
              github_url: 'https://github.com/ac3charland/doomed',
              key: 'DMD',
            }),
          ).rejects.toThrow('boom');
        });

        // Only the originally-seeded project remains.
        expect(result.current.projects.map((p) => p.id)).toEqual(['p1']);
      });
    });

    describe('createEpic', () => {
      it('inserts optimistically then reconciles the allocated ref', async () => {
        const saved: Epic = {
          id: 'server-e',
          project_id: 'p1',
          name: 'Refinement',
          notes: null,
          ref_number: 7,
          ref: 'ALF-7',
          archived_at: null,
          created_at: '2025-01-03T00:00:00Z',
        };
        mockCreateEpic.mockResolvedValue(saved);
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A] }),
        });

        await act(async () => {
          await result.current.actions.createEpic('p1', 'Refinement');
        });

        expect(result.current.board.activeEpics.map((b) => b.epic.ref)).toEqual(['ALF-7']);
      });

      it('rolls the optimistic epic back out on failure', async () => {
        mockCreateEpic.mockRejectedValue(new Error('nope'));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A] }),
        });

        await act(async () => {
          await expect(result.current.actions.createEpic('p1', 'Doomed')).rejects.toThrow('nope');
        });

        expect(result.current.board.activeEpics).toEqual([]);
      });
    });

    describe('enterCodeModule / convertTaskToCode', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      const savedSidecar: CodeItem = {
        item_id: 'task-1',
        project_id: 'p1',
        epic_id: 'e1',
        ref_number: 9,
        ref: 'ALF-9',
        factory_state: 'needs_refinement',
        lane: 'human',
        spec_path: null,
        spec_sha: null,
        spec_markdown: null,
        refinement_pr_url: null,
        implementation_pr_url: null,
        blocked_reason: null,
        created_at: '2025-01-04T00:00:00Z',
        updated_at: '2025-01-04T00:00:00Z',
      };

      it('inserts an optimistic card immediately and reconciles the allocated ref', async () => {
        mockEnterCodeModule.mockResolvedValue(savedSidecar);
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        let returned: CodeStory | undefined;
        await act(async () => {
          returned = await result.current.actions.convertTaskToCode(
            { id: 'task-1', title: 'Convert me', notes: null, source_url: null },
            'p1',
            'e1',
          );
        });

        expect(returned?.ref).toBe('ALF-9');
        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories.map((s) => s.ref)).toEqual(['ALF-9']);
        expect(lane?.stories[0]?.title).toBe('Convert me');
      });

      it('rolls the optimistic card back out on failure', async () => {
        mockEnterCodeModule.mockRejectedValue(new Error('gate failed'));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        await act(async () => {
          await expect(
            result.current.actions.convertTaskToCode(
              { id: 'task-1', title: 'Convert me', notes: null, source_url: null },
              'p1',
              'e1',
            ),
          ).rejects.toThrow('gate failed');
        });

        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories).toEqual([]);
      });

      it('throws if the project or epic is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [], epics: [] }),
        });

        await act(async () => {
          await expect(
            result.current.convertTaskToCode(
              { id: 'task-1', title: 'No project', notes: null, source_url: null },
              'missing',
              'missing',
            ),
          ).rejects.toThrow(/missing from the code store/i);
        });
        expect(mockEnterCodeModule).not.toHaveBeenCalled();
      });

      it('shows the optimistic card before the server resolves', async () => {
        // A never-resolving call keeps the request in flight: the card must already be on
        // the board from the optimistic insert alone.
        mockEnterCodeModule.mockImplementation(() => new Promise(() => {}));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        act(() => {
          void result.current.actions.convertTaskToCode(
            { id: 'task-1', title: 'Pending', notes: null, source_url: null },
            'p1',
            'e1',
          );
        });

        await waitFor(() => {
          const lane = result.current.board.activeEpics[0]?.lanes.find(
            (l) => l.state === 'needs_refinement',
          );
          expect(lane?.stories.map((s) => s.title)).toEqual(['Pending']);
        });
      });
    });

    describe('createStory (new story from the board)', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      const savedSidecar: CodeItem = {
        item_id: 'server-item',
        project_id: 'p1',
        epic_id: 'e1',
        ref_number: 12,
        ref: 'ALF-12',
        factory_state: 'needs_refinement',
        lane: 'human',
        spec_path: null,
        spec_sha: null,
        spec_markdown: null,
        refinement_pr_url: null,
        implementation_pr_url: null,
        blocked_reason: null,
        created_at: '2025-01-05T00:00:00Z',
        updated_at: '2025-01-05T00:00:00Z',
      };

      it('inserts an optimistic card at needs_refinement, then reconciles the real item_id + ref', async () => {
        mockCreateCodeStory.mockResolvedValue(savedSidecar);
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        let returned: CodeStory | undefined;
        await act(async () => {
          returned = await result.current.actions.createStory('e1', 'Brand new story', null);
        });

        expect(mockCreateCodeStory).toHaveBeenCalledWith('p1', 'e1', 'Brand new story', null);
        expect(returned?.ref).toBe('ALF-12');
        expect(returned?.item_id).toBe('server-item');
        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories.map((s) => s.ref)).toEqual(['ALF-12']);
        expect(lane?.stories[0]?.title).toBe('Brand new story');
        expect(lane?.stories[0]?.item_id).toBe('server-item');
      });

      it('shows the optimistic card (keyed by a temp item id) before the server resolves', async () => {
        mockCreateCodeStory.mockImplementation(() => new Promise(() => {}));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        act(() => {
          void result.current.actions.createStory('e1', 'Pending story', 'with notes');
        });

        await waitFor(() => {
          const lane = result.current.board.activeEpics[0]?.lanes.find(
            (l) => l.state === 'needs_refinement',
          );
          expect(lane?.stories.map((s) => s.title)).toEqual(['Pending story']);
        });
        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        // The optimistic card carries a temp item id until the server row reconciles.
        expect(lane?.stories[0]?.item_id).toMatch(/^temp-/);
        expect(lane?.stories[0]?.notes).toBe('with notes');
      });

      it('rolls the optimistic card back out on failure', async () => {
        mockCreateCodeStory.mockRejectedValue(new Error('create failed'));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        await act(async () => {
          await expect(result.current.actions.createStory('e1', 'Doomed', null)).rejects.toThrow(
            'create failed',
          );
        });

        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories).toEqual([]);
      });

      it('throws (and does not call the api) when the epic is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [] }),
        });

        await act(async () => {
          await expect(result.current.createStory('missing', 'No epic', null)).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockCreateCodeStory).not.toHaveBeenCalled();
      });

      it('throws when the epic project is missing from the store', async () => {
        // An epic whose project isn't seeded — the optimistic card can't be built.
        const orphan = makeEpic('e9', 'ghost-project');
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [orphan] }),
        });

        await act(async () => {
          await expect(result.current.createStory('e9', 'Orphan', null)).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockCreateCodeStory).not.toHaveBeenCalled();
      });
    });

    describe('updateCodeState', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      it('patches the story state optimistically, then reconciles with the saved row', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ updated_at: '2025-03-03T00:00:00Z' }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.updateCodeState('ALF-42', 'in_refinement');
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_refinement', {});
        expect(findStoryState(result.current.board)).toBe('in_refinement');
      });

      it('shows the optimistic state before the server resolves', async () => {
        mockUpdateCodeState.mockImplementation(() => new Promise(() => {}));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        act(() => {
          void result.current.actions.updateCodeState('ALF-42', 'in_refinement');
        });

        await waitFor(() => {
          expect(findStoryState(result.current.board)).toBe('in_refinement');
        });
      });

      it('rolls the state back to its prior value on failure', async () => {
        mockUpdateCodeState.mockRejectedValue(new Error('patch failed'));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_dev',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(
            result.current.actions.updateCodeState('ALF-42', 'in_development'),
          ).rejects.toThrow('patch failed');
        });

        expect(findStoryState(result.current.board)).toBe('ready_for_dev');
      });

      it('forwards extra fields (e.g. blocked_reason) to the api client', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'blocked', blocked_reason: 'checks failing' }),
        );
        const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42' });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.updateCodeState('ALF-42', 'blocked', {
            blocked_reason: 'checks failing',
          });
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'blocked', {
          blocked_reason: 'checks failing',
        });
      });
    });

    describe('moveStoryToEpic', () => {
      const e1 = makeEpic('e1', 'p1', { name: 'Epic One', ref: 'ALF-1' });
      const e2 = makeEpic('e2', 'p1', { name: 'Epic Two', ref: 'ALF-2' });

      it('optimistically re-homes the card and patches the denormalised epic fields', async () => {
        mockMoveCodeEpic.mockImplementation(() => new Promise(() => {}));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          epic_name: 'Epic One',
          epic_ref: 'ALF-1',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [e1, e2], stories: [story] }),
        });

        act(() => {
          void result.current.actions.moveStoryToEpic('ALF-42', 'e2');
        });

        await waitFor(() => {
          const moved = findStory(result.current.board);
          expect(moved?.epic_id).toBe('e2');
        });
        const moved = findStory(result.current.board);
        expect(moved?.epic_name).toBe('Epic Two');
        expect(moved?.epic_ref).toBe('ALF-2');
        // It now groups under e2's block and no longer under e1's.
        const e2Board = result.current.board.activeEpics.find((b) => b.epic.id === 'e2');
        expect(e2Board?.lanes.flatMap((l) => l.stories).map((s) => s.item_id)).toContain('i1');
        const e1Board = result.current.board.activeEpics.find((b) => b.epic.id === 'e1');
        expect(e1Board?.lanes.flatMap((l) => l.stories).map((s) => s.item_id)).not.toContain('i1');
      });

      it('reconciles epic_id + the timestamp with the saved sidecar on success', async () => {
        mockMoveCodeEpic.mockResolvedValue(
          makeSavedSidecar({ epic_id: 'e2', updated_at: '2025-04-04T00:00:00Z' }),
        );
        const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42' });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [e1, e2], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.moveStoryToEpic('ALF-42', 'e2');
        });

        expect(mockMoveCodeEpic).toHaveBeenCalledWith('ALF-42', 'e2');
        const moved = findStory(result.current.board);
        expect(moved?.epic_id).toBe('e2');
        expect(moved?.code_updated_at).toBe('2025-04-04T00:00:00Z');
      });

      it('rolls all four epic fields back to the original epic on failure', async () => {
        mockMoveCodeEpic.mockRejectedValue(new Error('move failed'));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          epic_name: 'Epic One',
          epic_ref: 'ALF-1',
          epic_archived_at: null,
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [e1, e2], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.actions.moveStoryToEpic('ALF-42', 'e2')).rejects.toThrow(
            'move failed',
          );
        });

        const reverted = findStory(result.current.board);
        expect(reverted?.epic_id).toBe('e1');
        expect(reverted?.epic_name).toBe('Epic One');
        expect(reverted?.epic_ref).toBe('ALF-1');
        expect(reverted?.epic_archived_at).toBeNull();
      });

      it('throws (and does not call the api) when the ref is unknown', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [e1, e2], stories: [] }),
        });

        await act(async () => {
          await expect(result.current.moveStoryToEpic('ALF-999', 'e2')).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockMoveCodeEpic).not.toHaveBeenCalled();
      });

      it('throws (and does not call the api) when the target epic is unknown', async () => {
        const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42' });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [e1], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.moveStoryToEpic('ALF-42', 'e2')).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockMoveCodeEpic).not.toHaveBeenCalled();
      });
    });

    describe('updateEpic (name + notes + archive)', () => {
      it('optimistically patches epic name, then reconciles with the saved row', async () => {
        mockUpdateEpic.mockResolvedValue(makeSavedEpic({ name: 'Renamed Epic' }));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')] }),
        });

        await act(async () => {
          await result.current.actions.updateEpic('e1', { name: 'Renamed Epic' });
        });

        expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { name: 'Renamed Epic' });
        expect(result.current.board.activeEpics[0]?.epic.name).toBe('Renamed Epic');
      });

      it('rolls the name back when the API call fails', async () => {
        mockUpdateEpic.mockRejectedValue(new Error('patch failed'));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({
            projects: [PROJECT_A],
            epics: [makeEpic('e1', 'p1', { name: 'Original Name' })],
          }),
        });

        await act(async () => {
          await expect(
            result.current.actions.updateEpic('e1', { name: 'New Name' }),
          ).rejects.toThrow('patch failed');
        });

        expect(result.current.board.activeEpics[0]?.epic.name).toBe('Original Name');
      });

      it('optimistically patches epic notes, then reconciles with the saved row', async () => {
        mockUpdateEpic.mockResolvedValue(makeSavedEpic({ notes: 'Refine the routing' }));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')] }),
        });

        await act(async () => {
          await result.current.actions.updateEpic('e1', { notes: 'Refine the routing' });
        });

        expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { notes: 'Refine the routing' });
        expect(result.current.board.activeEpics[0]?.epic.notes).toBe('Refine the routing');
      });

      it('archives an epic optimistically (it leaves the active list)', async () => {
        mockUpdateEpic.mockResolvedValue(makeSavedEpic({ archived_at: '2026-02-01T00:00:00Z' }));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')] }),
        });

        await act(async () => {
          await result.current.actions.updateEpic('e1', { archived_at: '2026-02-01T00:00:00Z' });
        });

        expect(result.current.board.activeEpics).toEqual([]);
        expect(result.current.board.archivedEpics.map((b) => b.epic.id)).toEqual(['e1']);
      });

      it('un-archives an epic by clearing archived_at to null', async () => {
        mockUpdateEpic.mockResolvedValue(makeSavedEpic({ archived_at: null }));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({
            projects: [PROJECT_A],
            epics: [makeEpic('e1', 'p1', { archived_at: '2026-02-01T00:00:00Z' })],
          }),
        });

        await act(async () => {
          await result.current.actions.updateEpic('e1', { archived_at: null });
        });

        expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { archived_at: null });
        expect(result.current.board.activeEpics.map((b) => b.epic.id)).toEqual(['e1']);
        expect(result.current.board.archivedEpics).toEqual([]);
      });

      it('rolls the touched fields back on failure', async () => {
        mockUpdateEpic.mockRejectedValue(new Error('patch failed'));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({
            projects: [PROJECT_A],
            epics: [makeEpic('e1', 'p1', { notes: 'original' })],
          }),
        });

        await act(async () => {
          await expect(
            result.current.actions.updateEpic('e1', { notes: 'changed' }),
          ).rejects.toThrow('patch failed');
        });

        expect(result.current.board.activeEpics[0]?.epic.notes).toBe('original');
      });

      it('throws when the epic is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [] }),
        });

        await act(async () => {
          await expect(result.current.updateEpic('missing', { notes: 'x' })).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockUpdateEpic).not.toHaveBeenCalled();
      });
    });

    describe('updateStoryTitle (header inline edit)', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      it('optimistically patches the story title via updateItem, then reconciles', async () => {
        mockUpdateItem.mockResolvedValue({ title: 'Renamed story' } as never);
        const story = makeStory('i1', 'e1', 'p1', { title: 'Old title' });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.updateStoryTitle('i1', 'Renamed story');
        });

        expect(mockUpdateItem).toHaveBeenCalledWith('i1', { title: 'Renamed story' });
        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories[0]?.title).toBe('Renamed story');
      });

      it('rolls the title back on failure', async () => {
        mockUpdateItem.mockRejectedValue(new Error('rename failed'));
        const story = makeStory('i1', 'e1', 'p1', { title: 'Old title' });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(
            result.current.actions.updateStoryTitle('i1', 'Renamed story'),
          ).rejects.toThrow('rename failed');
        });

        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories[0]?.title).toBe('Old title');
      });

      it('throws when the story is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await expect(result.current.updateStoryTitle('nope', 'x')).rejects.toThrow(/not found/i);
        });
        expect(mockUpdateItem).not.toHaveBeenCalled();
      });
    });

    describe('openClaudeSession (await-write-then-open)', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      let openSpy: jest.SpiedFunction<typeof globalThis.open>;
      beforeEach(() => {
        openSpy = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
      });
      afterEach(() => {
        openSpy.mockRestore();
      });

      it('writes in_refinement and opens the refinement url for a needs_refinement story', async () => {
        mockUpdateCodeState.mockResolvedValue(makeSavedSidecar({ factory_state: 'in_refinement' }));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          title: 'Wire the webhook',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.openClaudeSession('ALF-42', 'refinement');
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_refinement', {});
        expect(openSpy).toHaveBeenCalledTimes(1);
        const [url, target] = openSpy.mock.calls[0] ?? [];
        expect(typeof url === 'string' ? url : url?.toString()).toContain(
          'https://claude.ai/code?repo=ac3charland%2Falfred',
        );
        expect(target).toBe('_blank');
      });

      it('writes in_development and opens the implementation url for a ready_for_dev story', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'in_development' }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_dev',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.openClaudeSession('ALF-42', 'implementation');
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_development', {});
        expect(openSpy).toHaveBeenCalledTimes(1);
      });

      it('awaits the state write BEFORE opening the tab (order matters)', async () => {
        const calls: string[] = [];
        mockUpdateCodeState.mockImplementation(() => {
          calls.push('write');
          return Promise.resolve(makeSavedSidecar({ factory_state: 'in_refinement' }));
        });
        openSpy.mockImplementation(() => {
          calls.push('open');
          return null;
        });
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.openClaudeSession('ALF-42', 'refinement');
        });

        expect(calls).toEqual(['write', 'open']);
      });

      it('does NOT open the tab when the state write fails', async () => {
        mockUpdateCodeState.mockRejectedValue(new Error('write failed'));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(
            result.current.actions.openClaudeSession('ALF-42', 'refinement'),
          ).rejects.toThrow('write failed');
        });

        expect(openSpy).not.toHaveBeenCalled();
      });

      it('throws (and does not write) when the story is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await expect(result.current.openClaudeSession('ALF-999', 'refinement')).rejects.toThrow(
            /not found|missing/i,
          );
        });
        expect(mockUpdateCodeState).not.toHaveBeenCalled();
        expect(openSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('codeItemToStoryPatch', () => {
    it('projects every sidecar field a code_items row contributes to its CodeStory', () => {
      const row = makeSavedSidecar({
        ref: 'ALF-42',
        ref_number: 42,
        factory_state: 'ready_for_dev',
        lane: 'human',
        spec_path: 'docs/specs/ALF-42.md',
        spec_sha: 'abc123',
        spec_markdown: '# Spec',
        refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/1',
        implementation_pr_url: 'https://github.com/ac3charland/alfred/pull/2',
        blocked_reason: 'checks failing',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-02-02T00:00:00Z',
      });

      expect(codeItemToStoryPatch(row)).toEqual({
        ref: 'ALF-42',
        ref_number: 42,
        factory_state: 'ready_for_dev',
        lane: 'human',
        spec_path: 'docs/specs/ALF-42.md',
        spec_sha: 'abc123',
        spec_markdown: '# Spec',
        refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/1',
        implementation_pr_url: 'https://github.com/ac3charland/alfred/pull/2',
        blocked_reason: 'checks failing',
        code_created_at: '2025-01-01T00:00:00Z',
        code_updated_at: '2025-02-02T00:00:00Z',
      });
    });
  });

  describe('realtime code_items subscription', () => {
    const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

    it('moves a story to its new factory_state lane on a simulated UPDATE', () => {
      const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'in_refinement' });
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });
      expect(findStoryState(result.current)).toBe('in_refinement');

      emitUpdate(
        makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'ready_for_dev' }),
      );

      expect(findStoryState(result.current)).toBe('ready_for_dev');
    });

    it('ignores an UPDATE for an item_id not in the store (no-op, no resurrection)', () => {
      const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'in_refinement' });
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      emitUpdate(makeSavedSidecar({ item_id: 'gone', ref: 'ALF-99', factory_state: 'done' }));

      // The seeded story is untouched and nothing was added for the unknown id.
      expect(findStoryState(result.current)).toBe('in_refinement');
      expect(findStory(result.current)?.ref).toBe('ALF-42');
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('leaves the board stable for an echo of the current state (idempotent)', () => {
      const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'ready_for_dev' });
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      emitUpdate(
        makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'ready_for_dev' }),
      );

      expect(findStoryState(result.current)).toBe('ready_for_dev');
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('applies a non-state field change but fires no toast for it', () => {
      const story = makeStory('i1', 'e1', 'p1', {
        ref: 'ALF-42',
        factory_state: 'in_refinement',
        spec_markdown: null,
      });
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      emitUpdate(
        makeSavedSidecar({
          item_id: 'i1',
          ref: 'ALF-42',
          factory_state: 'in_refinement',
          spec_markdown: '# fresh spec',
        }),
      );

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(findStory(result.current)?.spec_markdown).toBe('# fresh spec');
    });

    it('tears the channel down on unmount', () => {
      const { unmount } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
      });
      unmount();
      expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    });

    describe('notifications', () => {
      it('fires a toast naming the new lane on a state-changing UPDATE', () => {
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'in_refinement',
        });
        renderHook(() => useProjectBoard('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        emitUpdate(
          makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'ready_for_dev' }),
        );

        expect(mockShowToast).toHaveBeenCalledWith('ALF-42 moved to Ready for Dev', 'emphasis');
      });

      it('uses the escape-state label for a transition into Blocked', () => {
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'in_development',
        });
        renderHook(() => useProjectBoard('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        emitUpdate(makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'blocked' }));

        expect(mockShowToast).toHaveBeenCalledWith('ALF-42 moved to Blocked', 'emphasis');
      });

      describe('tab-title marker (backgrounded tab)', () => {
        const ORIGINAL_TITLE = 'alfred';

        beforeEach(() => {
          document.title = ORIGINAL_TITLE;
        });
        afterEach(() => {
          setHidden(false);
          document.title = ORIGINAL_TITLE;
        });

        it('marks the title while hidden and restores it on visibilitychange', () => {
          setHidden(true);
          const story = makeStory('i1', 'e1', 'p1', {
            ref: 'ALF-42',
            factory_state: 'in_refinement',
          });
          renderHook(() => useProjectBoard('p1'), {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
          });

          emitUpdate(
            makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'ready_for_dev' }),
          );
          expect(document.title).toBe('● ALF-42 → Ready for Dev');

          setHidden(false);
          act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
          });
          expect(document.title).toBe(ORIGINAL_TITLE);
        });

        it('does not mark the title when the tab is visible', () => {
          setHidden(false);
          const story = makeStory('i1', 'e1', 'p1', {
            ref: 'ALF-42',
            factory_state: 'in_refinement',
          });
          renderHook(() => useProjectBoard('p1'), {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
          });

          emitUpdate(
            makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'ready_for_dev' }),
          );

          expect(document.title).toBe(ORIGINAL_TITLE);
        });

        it('rolls multiple hidden transitions into a count and restores on window focus', () => {
          setHidden(true);
          const stories = [
            makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'in_refinement' }),
            makeStory('i2', 'e1', 'p1', { ref: 'ALF-43', factory_state: 'ready_for_dev' }),
          ];
          renderHook(() => useProjectBoard('p1'), {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories }),
          });

          emitUpdate(
            makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: 'ready_for_dev' }),
          );
          emitUpdate(
            makeSavedSidecar({ item_id: 'i2', ref: 'ALF-43', factory_state: 'in_development' }),
          );
          expect(document.title).toBe('(2) updates · ALF-43 → In Development');

          setHidden(false);
          act(() => {
            globalThis.dispatchEvent(new Event('focus'));
          });
          expect(document.title).toBe(ORIGINAL_TITLE);
        });
      });
    });
  });
});
