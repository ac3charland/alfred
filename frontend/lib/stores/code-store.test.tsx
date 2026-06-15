import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import {
  CodeProvider,
  HAPPY_PATH_STATES,
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
const mockUpdateCodeState = jest.mocked(api.updateCodeState);

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

/** The factory_state of item `i1` wherever it sits on the board (lane or escape bucket). */
function findStoryState(board: ReturnType<typeof useProjectBoard>): string | undefined {
  const story = board.activeEpics
    .flatMap((b) => [...b.lanes.flatMap((l) => l.stories), ...b.escapeStories])
    .find((s) => s.item_id === 'i1');
  return story?.factory_state ?? undefined;
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

    describe('openClaudeSession (§11.3 await-write-then-open)', () => {
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
});
