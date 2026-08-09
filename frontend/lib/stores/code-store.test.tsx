import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import { StoryCard } from '@/components/code/story-card';
import * as api from '@/lib/api-client';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import {
  ALL_FACTORY_STATES,
  type CodeActions,
  CodeProvider,
  DEFAULT_BACKLOG_STATUSES,
  HAPPY_PATH_STATES,
  codeItemToStoryPatch,
  codeReducer,
  isEscapeState,
  useBacklog,
  useCodeActions,
  useEpics,
  useProjectBoard,
  useProjects,
  useRankedProjects,
  useStoryRankFlags,
} from './code-store';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCreateProject = jest.mocked(api.createProject);
const mockCreateEpic = jest.mocked(api.createEpic);
const mockEnterCodeModule = jest.mocked(api.enterCodeModule);
const mockConvertToCodeEpic = jest.mocked(api.convertToCodeEpic);
const mockCreateCodeStory = jest.mocked(api.createCodeStory);
const mockUpdateCodeState = jest.mocked(api.updateCodeState);
const mockUpdateEpic = jest.mocked(api.updateEpic);
const mockUpdateProject = jest.mocked(api.updateProject);
const mockUpdateItem = jest.mocked(api.updateItem);
const mockMoveCodeEpic = jest.mocked(api.moveCodeEpic);
const mockReorderCode = jest.mocked(api.reorderCode);
const mockMoveCode = jest.mocked(api.moveCode);
const mockMoveCodeInProject = jest.mocked(api.moveCodeInProject);
const mockListCode = jest.mocked(api.listCode);

// Capture the realtime UPDATE handler the CodeProvider subscribes, so tests can drive a
// simulated `code_items` change through it without a live Realtime channel. (Overrides the
// no-op stub from jest.setup.ts — a file-level mock wins.)
// The provider subscribes one channel per table (`code_items` and `epics`), so the stub keys the
// captured handler by the filter's table — capturing a single handler would let the second
// subscription silently overwrite the first.
let mockRealtimeHandler: ((payload: { new: CodeItem }) => void) | undefined;
let mockEpicRealtimeHandler: ((payload: { new: Epic }) => void) | undefined;
const mockRemoveChannel = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
        if (filter.table === 'epics') {
          mockEpicRealtimeHandler = handler as (payload: { new: Epic }) => void;
        } else {
          mockRealtimeHandler = handler as (payload: { new: CodeItem }) => void;
        }
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

// Stub the clipboard helper so the launch tests control (and assert) the paste-fallback copy
// without depending on a real Clipboard API under jsdom. Defaults to a successful copy.
const mockCopyToClipboard = jest.fn<Promise<boolean>, [string]>();
jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: (text: string) => mockCopyToClipboard(text),
}));

beforeEach(() => {
  mockRealtimeHandler = undefined;
  mockEpicRealtimeHandler = undefined;
  // Default the paste-fallback copy to success; a test that exercises the no-clipboard path
  // overrides this with `mockResolvedValue(false)`.
  mockCopyToClipboard.mockResolvedValue(true);
});

const PROJECT_A: Project = {
  description: null,
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
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
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
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
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
    blocked_from: null,
    requires_refinement: true,
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
    epic_spec_path: null,
    priority: 1,
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
    blocked_from: null,
    requires_refinement: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-02-02T00:00:00Z',
    priority: 1,
    ...overrides,
  };
}

/** The live story row for item `i1` wherever it sits on the board (lane or escape bucket). */
function findStory(board: ReturnType<typeof useProjectBoard>): CodeStory | undefined {
  return board.activeEpics
    .flatMap((b) => [...b.lanes.flatMap((l) => l.stories), ...b.abandonedStories])
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

/** Drive a simulated `epics` UPDATE (the Worker's epic-spec snapshot) through its handler. */
function emitEpicUpdate(row: Epic) {
  act(() => {
    mockEpicRealtimeHandler?.({ new: row });
  });
}

/** Override `document.hidden` (jsdom leaves it non-configurable false by default). */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

/**
 * A tiny board harness: renders the live cards for project `p1` off `useProjectBoard`, so a
 * realtime-driven change to a story row (e.g. a PR url arriving) is observable in the DOM via
 * the card it mounts — the chip lives on `StoryCard`, driven only by the store's story row.
 */
function BoardCards() {
  const board = useProjectBoard('p1');
  const stories = board.activeEpics.flatMap((bucket) => [
    ...bucket.lanes.flatMap((lane) => lane.stories),
    ...bucket.abandonedStories,
  ]);
  return (
    <>
      {stories.map((liveStory) => (
        <StoryCard key={liveStory.item_id ?? ''} story={liveStory} />
      ))}
    </>
  );
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

/** Map each story's priority by item_id from a backlog list (for the reorder assertions). */
function prioritiesById(backlog: CodeStory[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const story of backlog) {
    if (story.item_id !== null) out[story.item_id] = story.priority;
  }
  return out;
}

/** Narrow a possibly-null `apply*Optimistic` return for a test that expects it to resolve. */
function unwrap<T>(value: T | null): T {
  if (value === null) throw new Error('expected a non-null value');
  return value;
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

    it('keeps a blocked story in the lane it was blocked from, and routes only abandoned aside', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { factory_state: 'blocked', blocked_from: 'in_development' }),
        makeStory('i2', 'e1', 'p1', { factory_state: 'abandoned' }),
        makeStory('i3', 'e1', 'p1', { factory_state: 'done' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      const [board] = result.current.activeEpics;
      const byState = new Map(board?.lanes.map((lane) => [lane.state, lane.stories]));
      expect(byState.get('in_development')?.map((story) => story.item_id)).toEqual(['i1']);
      // Only abandoned is set aside now; blocked lives in a lane.
      expect(board?.abandonedStories.map((story) => story.item_id)).toEqual(['i2']);
    });

    it('falls back to the first lane for a story blocked before an origin was recorded', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { factory_state: 'blocked', blocked_from: null }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      const [board] = result.current.activeEpics;
      const byState = new Map(board?.lanes.map((lane) => [lane.state, lane.stories]));
      // Legacy rows are surfaced rather than dropped off the board entirely.
      expect(byState.get('needs_refinement')?.map((story) => story.item_id)).toEqual(['i1']);
      expect(board?.abandonedStories).toEqual([]);
    });

    it('counts the epic’s blocked stories (the header badge), ignoring abandoned ones', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { factory_state: 'blocked', blocked_from: 'in_development' }),
        makeStory('i2', 'e1', 'p1', { factory_state: 'blocked', blocked_from: 'ready_for_dev' }),
        makeStory('i3', 'e1', 'p1', { factory_state: 'abandoned' }),
        makeStory('i4', 'e1', 'p1', { factory_state: 'done' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      expect(result.current.activeEpics[0]?.blockedCount).toBe(2);
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

    it('sorts each lane and the abandoned bucket by priority ascending', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { factory_state: 'in_development', priority: 30 }),
        makeStory('i2', 'e1', 'p1', { factory_state: 'in_development', priority: 10 }),
        makeStory('i3', 'e1', 'p1', { factory_state: 'in_development', priority: 20 }),
        makeStory('i4', 'e1', 'p1', {
          factory_state: 'blocked',
          blocked_from: 'in_development',
          priority: 25,
        }),
        makeStory('i5', 'e1', 'p1', { factory_state: 'abandoned', priority: 5 }),
        makeStory('i6', 'e1', 'p1', { factory_state: 'abandoned', priority: 40 }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      const [board] = result.current.activeEpics;
      const lane = board?.lanes.find((l) => l.state === 'in_development');
      // The blocked card sorts by priority among its lane-mates, not appended after them.
      expect(lane?.stories.map((s) => s.item_id)).toEqual(['i2', 'i3', 'i4', 'i1']);
      expect(board?.abandonedStories.map((s) => s.item_id)).toEqual(['i5', 'i6']);
    });

    it('sorts the Done lane by most-recently-updated (latest completion first), not priority', () => {
      // Priority order would be i1, i2, i3; recency order (code_updated_at desc) is i2, i3, i1.
      const stories = [
        makeStory('i1', 'e1', 'p1', {
          factory_state: 'done',
          priority: 1,
          code_updated_at: '2025-03-01T00:00:00Z',
        }),
        makeStory('i2', 'e1', 'p1', {
          factory_state: 'done',
          priority: 2,
          code_updated_at: '2025-05-01T00:00:00Z',
        }),
        makeStory('i3', 'e1', 'p1', {
          factory_state: 'done',
          priority: 3,
          code_updated_at: '2025-04-01T00:00:00Z',
        }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')], stories }),
      });
      const [board] = result.current.activeEpics;
      const lane = board?.lanes.find((l) => l.state === 'done');
      expect(lane?.stories.map((s) => s.item_id)).toEqual(['i2', 'i3', 'i1']);
    });

    it('orders epics by their best (lowest-priority) story, no-story epics last', () => {
      const epics = [
        makeEpic('e1', 'p1', { created_at: '2025-01-01T00:00:00Z' }),
        makeEpic('e2', 'p1', { created_at: '2025-01-02T00:00:00Z' }),
        makeEpic('e3', 'p1', { created_at: '2025-01-03T00:00:00Z' }),
      ];
      const stories = [
        // e2 holds the highest-ranked story (priority 2) → e2 should lead, then e1 (priority 7).
        makeStory('i1', 'e1', 'p1', { priority: 7 }),
        makeStory('i2', 'e2', 'p1', { priority: 2 }),
        // e3 has no stories → sorts last.
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories }),
      });
      expect(result.current.activeEpics.map((b) => b.epic.id)).toEqual(['e2', 'e1', 'e3']);
    });

    it('tie-breaks no-story epics by created_at ascending', () => {
      const epics = [
        makeEpic('e2', 'p1', { created_at: '2025-02-02T00:00:00Z' }),
        makeEpic('e1', 'p1', { created_at: '2025-01-01T00:00:00Z' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics }),
      });
      expect(result.current.activeEpics.map((b) => b.epic.id)).toEqual(['e1', 'e2']);
    });

    it('excludes done/abandoned stories from the epic rank (ALF-49)', () => {
      const epics = [
        makeEpic('e1', 'p1', { created_at: '2025-01-01T00:00:00Z' }),
        makeEpic('e2', 'p1', { created_at: '2025-01-02T00:00:00Z' }),
      ];
      const stories = [
        // e1's top-ranked story (priority 1) is done — it must NOT pull e1 up; e1 ranks by its
        // only outstanding story (priority 7).
        makeStory('i1', 'e1', 'p1', { priority: 1, factory_state: 'done' }),
        makeStory('i2', 'e1', 'p1', { priority: 7, factory_state: 'in_development' }),
        // e2's outstanding story (priority 5) outranks e1's 7, so e2 leads.
        makeStory('i3', 'e2', 'p1', { priority: 5, factory_state: 'in_development' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories }),
      });
      expect(result.current.activeEpics.map((b) => b.epic.id)).toEqual(['e2', 'e1']);
    });

    it('ranks an all-done epic last, as if it had no story (ALF-49)', () => {
      const epics = [
        makeEpic('e1', 'p1', { created_at: '2025-01-01T00:00:00Z' }),
        makeEpic('e2', 'p1', { created_at: '2025-01-02T00:00:00Z' }),
      ];
      const stories = [
        // e1 holds only a done story (priority 1) → no outstanding rank → sorts last.
        makeStory('i1', 'e1', 'p1', { priority: 1, factory_state: 'done' }),
        makeStory('i2', 'e2', 'p1', { priority: 9, factory_state: 'in_development' }),
      ];
      const { result } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories }),
      });
      expect(result.current.activeEpics.map((b) => b.epic.id)).toEqual(['e2', 'e1']);
    });
  });

  describe('useBacklog', () => {
    const epics = [makeEpic('e1', 'p1'), makeEpic('eX', 'p2')];

    it('returns the global cross-project list sorted by priority ascending', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 30 }),
        makeStory('i2', 'eX', 'p2', { priority: 10 }),
        makeStory('i3', 'e1', 'p1', { priority: 20 }),
      ];
      const { result } = renderHook(() => useBacklog({ statuses: ALL_FACTORY_STATES }), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics, stories }),
      });
      expect(result.current.map((s) => s.item_id)).toEqual(['i2', 'i3', 'i1']);
    });

    it('hides done/abandoned with the default statuses and reveals them when all are selected', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 10, factory_state: 'in_development' }),
        makeStory('i2', 'e1', 'p1', { priority: 20, factory_state: 'done' }),
        makeStory('i3', 'e1', 'p1', { priority: 30, factory_state: 'abandoned' }),
      ];
      const seed = { projects: [PROJECT_A], epics, stories };

      const hidden = renderHook(() => useBacklog({ statuses: DEFAULT_BACKLOG_STATUSES }), {
        wrapper: makeWrapper(seed),
      });
      expect(hidden.result.current.map((s) => s.item_id)).toEqual(['i1']);

      const shown = renderHook(() => useBacklog({ statuses: ALL_FACTORY_STATES }), {
        wrapper: makeWrapper(seed),
      });
      expect(shown.result.current.map((s) => s.item_id)).toEqual(['i1', 'i2', 'i3']);
    });

    it('lists only the stories whose status is in the selected set', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 10, factory_state: 'in_development' }),
        makeStory('i2', 'e1', 'p1', { priority: 20, factory_state: 'blocked' }),
        makeStory('i3', 'e1', 'p1', { priority: 30, factory_state: 'needs_refinement' }),
      ];
      const { result } = renderHook(
        () => useBacklog({ statuses: ['blocked', 'needs_refinement'] }),
        { wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories }) },
      );
      // 'in_development' is excluded; the rest keep priority order.
      expect(result.current.map((s) => s.item_id)).toEqual(['i2', 'i3']);
    });

    it('returns an empty list when no statuses are selected', () => {
      const stories = [makeStory('i1', 'e1', 'p1', { priority: 10 })];
      const { result } = renderHook(() => useBacklog({ statuses: [] }), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories }),
      });
      expect(result.current).toEqual([]);
    });

    describe('project filter (ALF-156)', () => {
      const filterStories = [
        makeStory('i1', 'e1', 'p1', { priority: 10 }),
        makeStory('i2', 'eX', 'p2', { priority: 20 }),
        makeStory('i3', 'e1', 'p1', { priority: 30 }),
      ];
      const seed = { projects: [PROJECT_A, PROJECT_B], epics, stories: filterStories };

      it('lists every project when no projectIds are passed', () => {
        const { result } = renderHook(() => useBacklog({ statuses: ALL_FACTORY_STATES }), {
          wrapper: makeWrapper(seed),
        });
        expect(result.current.map((s) => s.item_id)).toEqual(['i1', 'i2', 'i3']);
      });

      it('narrows the list to the selected projects, keeping global priority order', () => {
        const { result } = renderHook(
          () => useBacklog({ statuses: ALL_FACTORY_STATES, projectIds: ['p1'] }),
          { wrapper: makeWrapper(seed) },
        );
        expect(result.current.map((s) => s.item_id)).toEqual(['i1', 'i3']);
      });

      it('returns an empty list when no projects are selected', () => {
        const { result } = renderHook(
          () => useBacklog({ statuses: ALL_FACTORY_STATES, projectIds: [] }),
          { wrapper: makeWrapper(seed) },
        );
        expect(result.current).toEqual([]);
      });

      it('applies the status and project filters together', () => {
        const stories = [
          makeStory('i1', 'e1', 'p1', { priority: 10, factory_state: 'in_development' }),
          makeStory('i2', 'e1', 'p1', { priority: 20, factory_state: 'done' }),
          makeStory('i3', 'eX', 'p2', { priority: 30, factory_state: 'in_development' }),
        ];
        const { result } = renderHook(
          () => useBacklog({ statuses: DEFAULT_BACKLOG_STATUSES, projectIds: ['p1'] }),
          { wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics, stories }) },
        );
        // p2's story is filtered out by project; p1's done story by status.
        expect(result.current.map((s) => s.item_id)).toEqual(['i1']);
      });

      it('hides a story with no project when the filter is narrowed', () => {
        const stories = [
          makeStory('i1', 'e1', 'p1', { priority: 10 }),
          makeStory('i2', 'e1', 'p1', { priority: 20, project_id: null }),
        ];
        const { result } = renderHook(
          () => useBacklog({ statuses: ALL_FACTORY_STATES, projectIds: ['p1'] }),
          { wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories }) },
        );
        expect(result.current.map((s) => s.item_id)).toEqual(['i1']);
      });
    });
  });

  describe('useStoryRankFlags', () => {
    const epics = [makeEpic('e1', 'p1'), makeEpic('eX', 'p2')];

    /** Read the flags for `story` with the whole seeded set in the store. */
    function flagsFor(story: CodeStory, stories: CodeStory[]) {
      const { result } = renderHook(() => useStoryRankFlags(story), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics, stories }),
      });
      return result.current;
    }

    it('marks a lone story as holding every slot', () => {
      const only = makeStory('i1', 'e1', 'p1', { priority: 10 });
      expect(flagsFor(only, [only])).toEqual({
        isProjectTop: true,
        isProjectBottom: true,
        isBacklogTop: true,
        isBacklogBottom: true,
      });
    });

    it('marks a story ranked between peers as holding no slot', () => {
      const middle = makeStory('i2', 'e1', 'p1', { priority: 20 });
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 10 }),
        middle,
        makeStory('i3', 'e1', 'p1', { priority: 30 }),
      ];
      expect(flagsFor(middle, stories)).toEqual({
        isProjectTop: false,
        isProjectBottom: false,
        isBacklogTop: false,
        isBacklogBottom: false,
      });
    });

    it('separates the project slot from the whole-Backlog slot', () => {
      const leader = makeStory('i2', 'e1', 'p1', { priority: 20 });
      const stories = [
        // Another project outranks p1's best, and trails p1's worst.
        makeStory('i1', 'eX', 'p2', { priority: 10 }),
        leader,
        makeStory('i3', 'e1', 'p1', { priority: 30 }),
        makeStory('i4', 'eX', 'p2', { priority: 40 }),
      ];
      expect(flagsFor(leader, stories)).toEqual({
        isProjectTop: true,
        isProjectBottom: false,
        isBacklogTop: false,
        isBacklogBottom: false,
      });
    });

    it('ignores done/abandoned peers, which the Backlog hides', () => {
      const story = makeStory('i2', 'e1', 'p1', { priority: 20 });
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 10, factory_state: 'done' }),
        story,
        makeStory('i3', 'e1', 'p1', { priority: 30, factory_state: 'abandoned' }),
      ];
      // Both peers keep their priority but are hidden, so `story` leads and trails alone.
      expect(flagsFor(story, stories)).toEqual({
        isProjectTop: true,
        isProjectBottom: true,
        isBacklogTop: true,
        isBacklogBottom: true,
      });
    });

    it('still ranks a done story against the outstanding work around it', () => {
      const finished = makeStory('i2', 'e1', 'p1', { priority: 20, factory_state: 'done' });
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 10 }),
        finished,
        makeStory('i3', 'e1', 'p1', { priority: 30 }),
      ];
      expect(flagsFor(finished, stories)).toEqual({
        isProjectTop: false,
        isProjectBottom: false,
        isBacklogTop: false,
        isBacklogBottom: false,
      });
    });

    it('treats an unranked story (null priority) as sitting at the bottom', () => {
      const unranked = makeStory('i2', 'e1', 'p1', { priority: null });
      const stories = [makeStory('i1', 'e1', 'p1', { priority: 10 }), unranked];
      expect(flagsFor(unranked, stories)).toEqual({
        isProjectTop: false,
        isProjectBottom: true,
        isBacklogTop: false,
        isBacklogBottom: true,
      });
    });

    it('holds every slot for a null story (the modal before one is chosen)', () => {
      const { result } = renderHook(() => useStoryRankFlags(null), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics, stories: [] }),
      });
      expect(result.current).toEqual({
        isProjectTop: true,
        isProjectBottom: true,
        isBacklogTop: true,
        isBacklogBottom: true,
      });
    });
  });

  describe('useRankedProjects (ALF-49)', () => {
    const epics = [makeEpic('e1', 'p1'), makeEpic('eX', 'p2')];

    it('orders projects by their best outstanding story priority', () => {
      const stories = [
        makeStory('i1', 'e1', 'p1', { priority: 30, factory_state: 'in_development' }),
        makeStory('i2', 'eX', 'p2', { priority: 10, factory_state: 'in_development' }),
      ];
      const { result } = renderHook(() => useRankedProjects(), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics, stories }),
      });
      // p2 holds the highest-ranked story (priority 10) → p2 leads p1 (priority 30).
      expect(result.current.map((p) => p.id)).toEqual(['p2', 'p1']);
    });

    it('excludes done/abandoned stories from a project rank', () => {
      const stories = [
        // p1's top-ranked story (priority 1) is done — it must NOT pull p1 up; p1 ranks 20.
        makeStory('i1', 'e1', 'p1', { priority: 1, factory_state: 'done' }),
        makeStory('i2', 'e1', 'p1', { priority: 20, factory_state: 'in_development' }),
        // p2's outstanding story (priority 10) outranks p1's 20, so p2 leads.
        makeStory('i3', 'eX', 'p2', { priority: 10, factory_state: 'in_development' }),
      ];
      const { result } = renderHook(() => useRankedProjects(), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics, stories }),
      });
      expect(result.current.map((p) => p.id)).toEqual(['p2', 'p1']);
    });

    it('sorts a project with no outstanding story last, tie-broken by created_at', () => {
      const stories = [
        // p2 has only a done story → no outstanding rank → sorts last despite an earlier seed
        // position; p1 leads on its outstanding story.
        makeStory('i1', 'e1', 'p1', { priority: 50, factory_state: 'in_development' }),
        makeStory('i2', 'eX', 'p2', { priority: 1, factory_state: 'done' }),
      ];
      const { result } = renderHook(() => useRankedProjects(), {
        wrapper: makeWrapper({ projects: [PROJECT_A, PROJECT_B], epics, stories }),
      });
      expect(result.current.map((p) => p.id)).toEqual(['p1', 'p2']);
    });

    it('keeps seed order among projects with no outstanding stories (created_at tie-break)', () => {
      const { result } = renderHook(() => useRankedProjects(), {
        // PROJECT_A (2025-01-01) before PROJECT_B (2025-01-02); pass them reversed to prove the
        // sort, not the seed order, decides.
        wrapper: makeWrapper({ projects: [PROJECT_B, PROJECT_A], epics }),
      });
      expect(result.current.map((p) => p.id)).toEqual(['p1', 'p2']);
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
          spec_path: null,
          spec_sha: null,
          spec_markdown: null,
          refinement_pr_url: null,
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
        blocked_from: null,
        requires_refinement: true,
        created_at: '2025-01-04T00:00:00Z',
        updated_at: '2025-01-04T00:00:00Z',
        priority: 1,
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

      it('lands the gated card at the top of the backlog (ALF-71)', async () => {
        mockEnterCodeModule.mockImplementation(() => new Promise(() => {}));
        const existing = [
          makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 }),
          makeStory('old-2', 'e1', 'p1', { ref: 'ALF-8', priority: 8 }),
        ];
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          { wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: existing }) },
        );

        act(() => {
          void result.current.actions.convertTaskToCode(
            { id: 'task-1', title: 'Gated', notes: null, source_url: null },
            'p1',
            'e1',
          );
        });

        await waitFor(() => {
          expect(result.current.backlog[0]?.title).toBe('Gated');
        });
        // The gated story outranks every pre-existing one (lower number = higher rank).
        expect(result.current.backlog[0]?.priority).toBeLessThan(5);
      });

      it('lands at the top of its project, but does not leapfrog a better-ranked story from another project (ALF-110)', async () => {
        mockEnterCodeModule.mockImplementation(() => new Promise(() => {}));
        const otherProjectBest = makeStory('other-1', 'e2', 'p2', { ref: 'RLP-1', priority: 1 });
        const existing = [
          otherProjectBest,
          makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 }),
          makeStory('old-2', 'e1', 'p1', { ref: 'ALF-8', priority: 8 }),
        ];
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epic, makeEpic('e2', 'p2')],
              stories: existing,
            }),
          },
        );

        act(() => {
          void result.current.actions.convertTaskToCode(
            { id: 'task-1', title: 'Gated', notes: null, source_url: null },
            'p1',
            'e1',
          );
        });

        await waitFor(() => {
          expect(result.current.backlog.some((s) => s.title === 'Gated')).toBe(true);
        });
        const gated = result.current.backlog.find((s) => s.title === 'Gated');
        // Outranks its own project's stories (below 5)…
        expect(gated?.priority).toBeLessThan(5);
        // …but does NOT outrank the other project's story (1) — the whole Backlog is undisturbed.
        expect(gated?.priority).toBeGreaterThan(1);
      });
    });

    describe('convertToCodeEpic (the epic conversion)', () => {
      const PARENT = { id: 'parent-1', title: 'Construction inbox', notes: 'epic notes' };
      const CHILDREN = [
        { id: 'ch-1', title: 'S1', notes: null, source_url: null },
        { id: 'ch-2', title: 'S2', notes: null, source_url: null },
        { id: 'ch-3', title: 'S3', notes: null, source_url: null },
      ];

      const SAVED_EPIC: Epic = {
        id: 'server-epic',
        project_id: 'p1',
        name: 'Construction inbox',
        notes: 'epic notes',
        ref_number: 40,
        ref: 'ALF-40',
        archived_at: null,
        spec_path: null,
        spec_sha: null,
        spec_markdown: null,
        refinement_pr_url: null,
        created_at: '2025-01-06T00:00:00Z',
      };
      const SAVED_RESULT = {
        epic: SAVED_EPIC,
        stories: [
          makeSavedSidecar({
            item_id: 'ch-1',
            epic_id: 'server-epic',
            ref: 'ALF-43',
            ref_number: 43,
            factory_state: 'needs_refinement',
            priority: -3,
          }),
          makeSavedSidecar({
            item_id: 'ch-2',
            epic_id: 'server-epic',
            ref: 'ALF-42',
            ref_number: 42,
            factory_state: 'needs_refinement',
            priority: -2,
          }),
          makeSavedSidecar({
            item_id: 'ch-3',
            epic_id: 'server-epic',
            ref: 'ALF-41',
            ref_number: 41,
            factory_state: 'needs_refinement',
            priority: -1,
          }),
        ],
      };

      it('inserts an optimistic epic (title + notes) with one card per child, in display order', async () => {
        mockConvertToCodeEpic.mockImplementation(() => new Promise(() => {}));
        const existing = makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 });
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            board: useProjectBoard('p1'),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A],
              epics: [makeEpic('e1', 'p1')],
              stories: [existing],
            }),
          },
        );

        act(() => {
          void result.current.actions.convertToCodeEpic(PARENT, CHILDREN, 'p1');
        });

        await waitFor(() => {
          expect(result.current.backlog.some((s) => s.title === 'S1')).toBe(true);
        });
        // The optimistic epic carries the parent's title AND notes.
        const epicBoard = result.current.board.activeEpics.find(
          (b) => b.epic.name === 'Construction inbox',
        );
        expect(epicBoard?.epic.notes).toBe('epic notes');
        // Backlog order: S1 < S2 < S3 < the pre-existing story (the reverse fold).
        expect(result.current.backlog.map((s) => s.title)).toEqual([
          'S1',
          'S2',
          'S3',
          'Story old-1',
        ]);
      });

      it('does not displace a better-ranked story from another project (ALF-110)', async () => {
        mockConvertToCodeEpic.mockImplementation(() => new Promise(() => {}));
        const otherBest = makeStory('other-1', 'e2', 'p2', { ref: 'RLP-1', priority: 1 });
        const mine = makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 });
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [makeEpic('e1', 'p1'), makeEpic('e2', 'p2')],
              stories: [otherBest, mine],
            }),
          },
        );

        act(() => {
          void result.current.actions.convertToCodeEpic(PARENT, CHILDREN, 'p1');
        });

        await waitFor(() => {
          expect(result.current.backlog.some((s) => s.title === 'S1')).toBe(true);
        });
        // The other project's story keeps the whole-Backlog top; the group slots between it
        // and this project's previous best.
        expect(result.current.backlog.map((s) => s.title)).toEqual([
          'Story other-1',
          'S1',
          'S2',
          'S3',
          'Story old-1',
        ]);
      });

      it('reconciles the saved epic and re-homes each story onto it', async () => {
        mockConvertToCodeEpic.mockResolvedValue(SAVED_RESULT);
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [] }),
        });

        let returned: api.ConvertedEpic | undefined;
        await act(async () => {
          returned = await result.current.actions.convertToCodeEpic(PARENT, CHILDREN, 'p1');
        });

        expect(mockConvertToCodeEpic).toHaveBeenCalledWith('parent-1', 'p1');
        expect(returned?.epic.ref).toBe('ALF-40');
        expect(returned?.stories).toHaveLength(3);
        // The board shows the reconciled epic with all three stories under it at
        // needs_refinement, carrying their allocated refs.
        const epicBoard = result.current.board.activeEpics.find((b) => b.epic.id === 'server-epic');
        expect(epicBoard?.epic.ref).toBe('ALF-40');
        const lane = epicBoard?.lanes.find((l) => l.state === 'needs_refinement');
        expect(lane?.stories.map((s) => s.ref)).toEqual(['ALF-43', 'ALF-42', 'ALF-41']);
        expect(lane?.stories.map((s) => s.epic_ref)).toEqual(['ALF-40', 'ALF-40', 'ALF-40']);
      });

      it('rolls the optimistic epic and stories back out on failure', async () => {
        mockConvertToCodeEpic.mockRejectedValue(new Error('conversion failed'));
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            board: useProjectBoard('p1'),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          { wrapper: makeWrapper({ projects: [PROJECT_A] }) },
        );

        await act(async () => {
          await expect(
            result.current.actions.convertToCodeEpic(PARENT, CHILDREN, 'p1'),
          ).rejects.toThrow('conversion failed');
        });

        expect(result.current.board.activeEpics).toEqual([]);
        expect(result.current.backlog).toEqual([]);
        expect(mockShowToast).toHaveBeenCalledWith("Couldn't create epic");
      });

      it('throws (and never calls the API) when the project is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [] }),
        });

        await act(async () => {
          await expect(
            result.current.convertToCodeEpic(PARENT, CHILDREN, 'missing'),
          ).rejects.toThrow(/not found in the code store/i);
        });
        expect(mockConvertToCodeEpic).not.toHaveBeenCalled();
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
        blocked_from: null,
        requires_refinement: true,
        created_at: '2025-01-05T00:00:00Z',
        updated_at: '2025-01-05T00:00:00Z',
        priority: 1,
      };

      it('inserts an optimistic card at needs_refinement, then reconciles the real item_id + ref', async () => {
        mockCreateCodeStory.mockResolvedValue(savedSidecar);
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        let returned: CodeStory | undefined;
        await act(async () => {
          returned = await result.current.actions.createStory('e1', 'Brand new story', null, true);
        });

        expect(mockCreateCodeStory).toHaveBeenCalledWith('p1', 'e1', 'Brand new story', null, true);
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
          void result.current.actions.createStory('e1', 'Pending story', 'with notes', true);
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
          await expect(
            result.current.actions.createStory('e1', 'Doomed', null, true),
          ).rejects.toThrow('create failed');
        });

        const lane = result.current.board.activeEpics[0]?.lanes.find(
          (l) => l.state === 'needs_refinement',
        );
        expect(lane?.stories).toEqual([]);
      });

      it('lands the optimistic card at the top of the backlog (ALF-71)', async () => {
        // A never-resolving call keeps the optimistic card in flight so we read its placement
        // before the server priority reconciles.
        mockCreateCodeStory.mockImplementation(() => new Promise(() => {}));
        const existing = [
          makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 }),
          makeStory('old-2', 'e1', 'p1', { ref: 'ALF-8', priority: 8 }),
        ];
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          { wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: existing }) },
        );

        act(() => {
          void result.current.actions.createStory('e1', 'Newest story', null, true);
        });

        await waitFor(() => {
          expect(result.current.backlog[0]?.title).toBe('Newest story');
        });
        // It outranks every pre-existing story (lower priority number = higher rank).
        expect(result.current.backlog[0]?.priority).toBeLessThan(5);
        expect(result.current.backlog.map((s) => s.priority?.toString())).toEqual([
          result.current.backlog[0]?.priority?.toString(),
          '5',
          '8',
        ]);
      });

      it('lands at the top of its project, but does not leapfrog a better-ranked story from another project (ALF-110)', async () => {
        mockCreateCodeStory.mockImplementation(() => new Promise(() => {}));
        const otherProjectBest = makeStory('other-1', 'e2', 'p2', { ref: 'RLP-1', priority: 1 });
        const existing = [
          otherProjectBest,
          makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 }),
          makeStory('old-2', 'e1', 'p1', { ref: 'ALF-8', priority: 8 }),
        ];
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epic, makeEpic('e2', 'p2')],
              stories: existing,
            }),
          },
        );

        act(() => {
          void result.current.actions.createStory('e1', 'Newest story', null, true);
        });

        await waitFor(() => {
          expect(result.current.backlog.some((s) => s.title === 'Newest story')).toBe(true);
        });
        const created = result.current.backlog.find((s) => s.title === 'Newest story');
        // Outranks its own project's stories (below 5)…
        expect(created?.priority).toBeLessThan(5);
        // …but does NOT outrank the other project's story (1) — the whole Backlog is undisturbed.
        expect(created?.priority).toBeGreaterThan(1);
      });

      it('lands above the project’s top OUTSTANDING story, ignoring a completed story ranked better (ALF-120)', async () => {
        mockCreateCodeStory.mockImplementation(() => new Promise(() => {}));
        // p1's best-ranked row is a DONE story at the global top (1) — completed but still holding
        // its priority. Its outstanding stories start at 5. Another project has an outstanding
        // story at 3. A new p1 story must land above p1's top OUTSTANDING (5), NOT above the hidden
        // done story at the global top — the ALF-120 bug landed it at ~0 (top of the whole Backlog).
        const existing = [
          makeStory('done-1', 'e1', 'p1', { ref: 'ALF-1', priority: 1, factory_state: 'done' }),
          makeStory('other-1', 'e2', 'p2', { ref: 'RLP-1', priority: 3 }),
          makeStory('old-1', 'e1', 'p1', { ref: 'ALF-5', priority: 5 }),
          makeStory('old-2', 'e1', 'p1', { ref: 'ALF-8', priority: 8 }),
        ];
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epic, makeEpic('e2', 'p2')],
              stories: existing,
            }),
          },
        );

        act(() => {
          void result.current.actions.createStory('e1', 'Newest story', null, true);
        });

        await waitFor(() => {
          expect(result.current.backlog.some((s) => s.title === 'Newest story')).toBe(true);
        });
        const created = result.current.backlog.find((s) => s.title === 'Newest story');
        // Above its project's top OUTSTANDING story (5)…
        expect(created?.priority).toBeLessThan(5);
        // …but does NOT leapfrog the other project's outstanding story (3) — so it is NOT dragged
        // to the global top by the completed story that outranks everything.
        expect(created?.priority).toBeGreaterThan(3);
      });

      it('throws (and does not call the api) when the epic is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [] }),
        });

        await act(async () => {
          await expect(
            result.current.createStory('missing', 'No epic', null, true),
          ).rejects.toThrow(/not found/i);
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
          await expect(result.current.createStory('e9', 'Orphan', null, true)).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockCreateCodeStory).not.toHaveBeenCalled();
      });

      it('lands the optimistic card in Ready for Dev when the box is unchecked', async () => {
        // Never resolves, so the assertion reads the OPTIMISTIC placement — the card must
        // appear in the right lane immediately rather than hopping across on reconcile.
        mockCreateCodeStory.mockImplementation(() => new Promise(() => {}));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        act(() => {
          void result.current.actions.createStory('e1', 'No spec needed', null, false);
        });

        await waitFor(() => {
          const lanes = result.current.board.activeEpics[0]?.lanes;
          expect(
            lanes?.find((l) => l.state === 'ready_for_dev')?.stories.map((s) => s.title),
          ).toEqual(['No spec needed']);
        });
        const lanes = result.current.board.activeEpics[0]?.lanes;
        expect(lanes?.find((l) => l.state === 'needs_refinement')?.stories).toEqual([]);
        expect(
          lanes?.find((l) => l.state === 'ready_for_dev')?.stories[0]?.requires_refinement,
        ).toBe(false);
        expect(mockCreateCodeStory).toHaveBeenCalledWith('p1', 'e1', 'No spec needed', null, false);
      });
    });

    describe('setRefinementRequired (the mark — moves the card, opens nothing)', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      it('clears the mark and fast-forwards a needs_refinement story to Ready for Dev', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'ready_for_dev', requires_refinement: false }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.setRefinementRequired('ALF-42', false);
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'ready_for_dev', {
          requires_refinement: false,
        });
        expect(findStoryState(result.current.board)).toBe('ready_for_dev');
        expect(findStory(result.current.board)?.requires_refinement).toBe(false);
      });

      it('patches the flag AND the lane optimistically, before the server resolves', async () => {
        mockUpdateCodeState.mockImplementation(() => new Promise(() => {}));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        act(() => {
          void result.current.actions.setRefinementRequired('ALF-42', false);
        });

        await waitFor(() => {
          expect(findStoryState(result.current.board)).toBe('ready_for_dev');
        });
        expect(findStory(result.current.board)?.requires_refinement).toBe(false);
      });

      it('re-setting the mark rewinds a spec-less ready_for_dev story', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'needs_refinement', requires_refinement: true }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_dev',
          requires_refinement: false,
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.setRefinementRequired('ALF-42', true);
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'needs_refinement', {
          requires_refinement: true,
        });
        expect(findStoryState(result.current.board)).toBe('needs_refinement');
      });

      it('records the mark WITHOUT moving a story mid-flight', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'ready_for_review', requires_refinement: false }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_review',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.setRefinementRequired('ALF-42', false);
        });

        // The state it sends back is the state it is already in — a deliberate no-op write.
        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'ready_for_review', {
          requires_refinement: false,
        });
        expect(findStoryState(result.current.board)).toBe('ready_for_review');
        expect(findStory(result.current.board)?.requires_refinement).toBe(false);
      });

      it('never rewinds a story that already has a committed spec', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'ready_for_dev', requires_refinement: true }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_dev',
          spec_path: 'docs/specs/ALF-42.html',
          requires_refinement: false,
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.setRefinementRequired('ALF-42', true);
        });

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'ready_for_dev', {
          requires_refinement: true,
        });
        expect(findStoryState(result.current.board)).toBe('ready_for_dev');
      });

      it('rolls BOTH the flag and the state back on failure', async () => {
        mockUpdateCodeState.mockRejectedValue(new Error('patch failed'));
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
          requires_refinement: true,
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(
            result.current.actions.setRefinementRequired('ALF-42', false),
          ).rejects.toThrow('patch failed');
        });

        expect(findStoryState(result.current.board)).toBe('needs_refinement');
        expect(findStory(result.current.board)?.requires_refinement).toBe(true);
        expect(mockShowToast).toHaveBeenCalledWith("Couldn't update refinement");
      });

      it('opens no tab — the mark is a judgement, not a launch', async () => {
        const openSpy = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'ready_for_dev', requires_refinement: false }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.setRefinementRequired('ALF-42', false);
        });

        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
      });

      it('throws when the story is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await expect(result.current.setRefinementRequired('ALF-999', false)).rejects.toThrow(
            /not found/i,
          );
        });
        expect(mockUpdateCodeState).not.toHaveBeenCalled();
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
          epic_spec_path: null,
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

    describe('applyReorderOptimistic + commitReorderBatch (Backlog priority swap)', () => {
      const epic = makeEpic('e1', 'p1');
      const high = makeStory('i1', 'e1', 'p1', { ref: 'ALF-1', priority: 1 });
      const low = makeStory('i2', 'e1', 'p1', { ref: 'ALF-2', priority: 2 });

      it('applyReorderOptimistic swaps the pair instantly, with no network call', () => {
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          { wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [high, low] }) },
        );

        let step: ReturnType<CodeActions['applyReorderOptimistic']> = null;
        act(() => {
          step = result.current.actions.applyReorderOptimistic('ALF-1', 'ALF-2');
        });

        expect(mockReorderCode).not.toHaveBeenCalled();
        expect(step).toEqual({
          ref: 'ALF-1',
          neighbourRef: 'ALF-2',
          aItemId: 'i1',
          bItemId: 'i2',
          aPriorityBefore: 1,
          bPriorityBefore: 2,
        });
        // ALF-2 now outranks ALF-1, so the backlog order flips — instantly, before any network.
        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 2, i2: 1 });
        expect(result.current.backlog.map((s) => s.ref)).toEqual(['ALF-2', 'ALF-1']);
      });

      it('applyReorderOptimistic returns null (and swaps nothing) when a ref is unknown', () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [high] }),
        });

        let step: ReturnType<CodeActions['applyReorderOptimistic']> = null;
        act(() => {
          step = result.current.applyReorderOptimistic('ALF-1', 'ALF-404');
        });

        expect(step).toBeNull();
        expect(mockReorderCode).not.toHaveBeenCalled();
      });

      it('commitReorderBatch sends one call per step, in order, and reconciles from each response', async () => {
        mockReorderCode.mockResolvedValue([
          makeSavedSidecar({ item_id: 'i1', ref: 'ALF-1', priority: 2 }),
          makeSavedSidecar({ item_id: 'i2', ref: 'ALF-2', priority: 1 }),
        ]);
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          { wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [high, low] }) },
        );

        let step!: NonNullable<ReturnType<CodeActions['applyReorderOptimistic']>>;
        act(() => {
          step = unwrap(result.current.actions.applyReorderOptimistic('ALF-1', 'ALF-2'));
        });

        await act(async () => {
          await result.current.actions.commitReorderBatch([step]);
        });

        expect(mockReorderCode).toHaveBeenCalledWith('ALF-1', 'ALF-2');
        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 2, i2: 1 });
      });

      it('on a failed step, rolls back that step and everything queued behind it — earlier steps stay committed', async () => {
        const third = makeStory('i3', 'e1', 'p1', { ref: 'ALF-3', priority: 3 });
        mockReorderCode
          .mockResolvedValueOnce([
            makeSavedSidecar({ item_id: 'i1', ref: 'ALF-1', priority: 2 }),
            makeSavedSidecar({ item_id: 'i2', ref: 'ALF-2', priority: 1 }),
          ])
          .mockRejectedValueOnce(new Error('swap failed'));
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A],
              epics: [epic],
              stories: [high, low, third],
            }),
          },
        );

        // Two clicks in one burst, each its own `act` (so the second reads the FIRST swap's
        // committed local state — exactly like two separate real clicks, re-rendered between):
        // ALF-1 swaps up past ALF-2, then past ALF-3.
        let stepOne!: NonNullable<ReturnType<CodeActions['applyReorderOptimistic']>>;
        let stepTwo!: NonNullable<ReturnType<CodeActions['applyReorderOptimistic']>>;
        act(() => {
          stepOne = unwrap(result.current.actions.applyReorderOptimistic('ALF-1', 'ALF-2'));
        });
        act(() => {
          stepTwo = unwrap(result.current.actions.applyReorderOptimistic('ALF-1', 'ALF-3'));
        });

        await act(async () => {
          await result.current.actions.commitReorderBatch([stepOne, stepTwo]);
        });

        expect(mockReorderCode).toHaveBeenNthCalledWith(1, 'ALF-1', 'ALF-2');
        expect(mockReorderCode).toHaveBeenNthCalledWith(2, 'ALF-1', 'ALF-3');
        // The first swap already committed server-side (i1↔i2 stays applied); the second (failed)
        // swap rolls back, so ALF-3 is restored to its original priority.
        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 2, i2: 1, i3: 3 });
      });
    });

    describe('applyMoveOptimistic + commitMove (Backlog jump to top/bottom)', () => {
      const epic = makeEpic('e1', 'p1');
      const a = makeStory('i1', 'e1', 'p1', { ref: 'ALF-1', priority: 10 });
      const b = makeStory('i2', 'e1', 'p1', { ref: 'ALF-2', priority: 20 });
      const c = makeStory('i3', 'e1', 'p1', { ref: 'ALF-3', priority: 30 });

      it('applyMoveOptimistic jumps the last story to the top instantly (min-1), with no network call', () => {
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [a, b, c] }),
          },
        );

        let applied: ReturnType<CodeActions['applyMoveOptimistic']> = null;
        act(() => {
          applied = result.current.actions.applyMoveOptimistic('ALF-3', true);
        });

        expect(mockMoveCode).not.toHaveBeenCalled();
        expect(applied).toEqual({ priorityBefore: 30 });
        expect(result.current.backlog.map((s) => s.ref)).toEqual(['ALF-3', 'ALF-1', 'ALF-2']);
      });

      it('applyMoveOptimistic jumps the first story to the bottom instantly (max+1)', () => {
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [a, b, c] }),
          },
        );

        act(() => {
          result.current.actions.applyMoveOptimistic('ALF-1', false);
        });

        expect(mockMoveCode).not.toHaveBeenCalled();
        expect(result.current.backlog.map((s) => s.ref)).toEqual(['ALF-2', 'ALF-3', 'ALF-1']);
      });

      it('applyMoveOptimistic returns null when the ref is unknown', () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [a] }),
        });

        let applied: ReturnType<CodeActions['applyMoveOptimistic']> = null;
        act(() => {
          applied = result.current.applyMoveOptimistic('ALF-404', true);
        });

        expect(applied).toBeNull();
        expect(mockMoveCode).not.toHaveBeenCalled();
      });

      it('commitMove sends the call and reconciles from the returned row', async () => {
        mockMoveCode.mockResolvedValue([
          makeSavedSidecar({ item_id: 'i3', ref: 'ALF-3', priority: -1 }),
        ]);
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [a, b, c] }),
          },
        );

        let applied!: NonNullable<ReturnType<CodeActions['applyMoveOptimistic']>>;
        act(() => {
          applied = unwrap(result.current.actions.applyMoveOptimistic('ALF-3', true));
        });

        await act(async () => {
          await result.current.actions.commitMove('ALF-3', true, applied.priorityBefore);
        });

        expect(mockMoveCode).toHaveBeenCalledWith('ALF-3', true);
        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 10, i2: 20, i3: -1 });
      });

      it('commitMove rolls the priority back to priorityBefore on API failure', async () => {
        mockMoveCode.mockRejectedValue(new Error('move failed'));
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [a, b, c] }),
          },
        );

        let applied!: NonNullable<ReturnType<CodeActions['applyMoveOptimistic']>>;
        act(() => {
          applied = unwrap(result.current.actions.applyMoveOptimistic('ALF-3', true));
        });

        await act(async () => {
          await result.current.actions.commitMove('ALF-3', true, applied.priorityBefore);
        });

        // Restored to the original ranking.
        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 10, i2: 20, i3: 30 });
      });
    });

    describe('applyMoveInProjectOptimistic + commitMoveInProject (Backlog jump to top/bottom of project, ALF-110)', () => {
      // p1 has two stories (a, b); p2 has one story ranked better than both (otherBetter) and one
      // ranked worse than both (otherWorse), so a project-scoped jump must land next to a/b
      // without crossing either of the other project's ranks.
      const epicA = makeEpic('e1', 'p1');
      const epicB = makeEpic('e2', 'p2');
      const a = makeStory('i1', 'e1', 'p1', { ref: 'ALF-1', priority: 10 });
      const b = makeStory('i2', 'e1', 'p1', { ref: 'ALF-2', priority: 30 });
      const otherBetter = makeStory('i3', 'e2', 'p2', { ref: 'RLP-1', priority: 5 });
      const otherWorse = makeStory('i4', 'e2', 'p2', { ref: 'RLP-2', priority: 40 });
      const allStories = [a, b, otherBetter, otherWorse];

      it('applyMoveInProjectOptimistic jumps to the top of its project instantly, stopping short of another project’s better rank — no network call', () => {
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epicA, epicB],
              stories: allStories,
            }),
          },
        );

        let applied: ReturnType<CodeActions['applyMoveInProjectOptimistic']> = null;
        act(() => {
          applied = result.current.actions.applyMoveInProjectOptimistic('ALF-2', true);
        });

        expect(mockMoveCodeInProject).not.toHaveBeenCalled();
        expect(applied).toEqual({ priorityBefore: 30 });
        // b now outranks a (top of p1) but stays behind otherBetter's rank of 5 — the optimistic
        // midpoint between otherBetter (5) and a (10) is 7.5, never leapfrogging otherBetter.
        const priorities = prioritiesById(result.current.backlog);
        expect(priorities['i2']).toBeLessThan(priorities['i1'] ?? Number.POSITIVE_INFINITY);
        expect(priorities['i2']).toBeGreaterThan(5);
        expect(priorities['i3']).toBe(5);
        expect(priorities['i4']).toBe(40);
      });

      it('applyMoveInProjectOptimistic jumps to the bottom of its project instantly, stopping short of another project’s worse rank', () => {
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epicA, epicB],
              stories: allStories,
            }),
          },
        );

        act(() => {
          result.current.actions.applyMoveInProjectOptimistic('ALF-1', false);
        });

        expect(mockMoveCodeInProject).not.toHaveBeenCalled();
        // a now ranks worse than b (bottom of p1) but stays ahead of otherWorse's rank of 40 —
        // the optimistic midpoint between b (30) and otherWorse (40) is 35.
        const priorities = prioritiesById(result.current.backlog);
        expect(priorities['i1']).toBeGreaterThan(priorities['i2'] ?? Number.NEGATIVE_INFINITY);
        expect(priorities['i1']).toBeLessThan(40);
        expect(priorities['i3']).toBe(5);
        expect(priorities['i4']).toBe(40);
      });

      it('applyMoveInProjectOptimistic ignores a completed story when finding the top of the project (ALF-120)', () => {
        // p1 also holds a DONE story ranked better (2) than every VISIBLE row — hidden from the
        // Backlog but still in the table. Jumping b to the top of p1 must land above p1's top
        // OUTSTANDING story (a, 10), NOT above the completed story: the pre-ALF-120 math counted
        // the done story as the project's top and sent b to ~1 (past otherBetter, near the global
        // top). The correct midpoint is between otherBetter (5) and a (10) → 7.5.
        const doneTop = makeStory('i5', 'e1', 'p1', {
          ref: 'ALF-9',
          priority: 2,
          factory_state: 'done',
        });
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epicA, epicB],
              stories: [...allStories, doneTop],
            }),
          },
        );

        act(() => {
          result.current.actions.applyMoveInProjectOptimistic('ALF-2', true);
        });

        const priorities = prioritiesById(result.current.backlog);
        // Above p1's top OUTSTANDING story (a, 10)…
        expect(priorities['i2']).toBeLessThan(priorities['i1'] ?? Number.POSITIVE_INFINITY);
        // …but NOT past the other project's better rank (5), and NOT past the hidden done story (2).
        expect(priorities['i2']).toBeGreaterThan(5);
        expect(priorities['i5']).toBe(2);
        expect(priorities['i3']).toBe(5);
      });

      it('applyMoveInProjectOptimistic returns null when the ref is unknown', () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epicA], stories: [a] }),
        });

        let applied: ReturnType<CodeActions['applyMoveInProjectOptimistic']> = null;
        act(() => {
          applied = result.current.applyMoveInProjectOptimistic('ALF-404', true);
        });

        expect(applied).toBeNull();
        expect(mockMoveCodeInProject).not.toHaveBeenCalled();
      });

      it('commitMoveInProject sends the call and reconciles from the returned row', async () => {
        mockMoveCodeInProject.mockResolvedValue([
          makeSavedSidecar({ item_id: 'i2', project_id: 'p1', ref: 'ALF-2', priority: 7.5 }),
        ]);
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epicA, epicB],
              stories: allStories,
            }),
          },
        );

        let applied!: NonNullable<ReturnType<CodeActions['applyMoveInProjectOptimistic']>>;
        act(() => {
          applied = unwrap(result.current.actions.applyMoveInProjectOptimistic('ALF-2', true));
        });

        await act(async () => {
          await result.current.actions.commitMoveInProject('ALF-2', true, applied.priorityBefore);
        });

        expect(mockMoveCodeInProject).toHaveBeenCalledWith('ALF-2', true);
        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 10, i2: 7.5, i3: 5, i4: 40 });
      });

      it('commitMoveInProject rolls the priority back to priorityBefore on API failure', async () => {
        mockMoveCodeInProject.mockRejectedValue(new Error('move failed'));
        const { result } = renderHook(
          () => ({
            actions: useCodeActions(),
            backlog: useBacklog({ statuses: ALL_FACTORY_STATES }),
          }),
          {
            wrapper: makeWrapper({
              projects: [PROJECT_A, PROJECT_B],
              epics: [epicA, epicB],
              stories: allStories,
            }),
          },
        );

        let applied!: NonNullable<ReturnType<CodeActions['applyMoveInProjectOptimistic']>>;
        act(() => {
          applied = unwrap(result.current.actions.applyMoveInProjectOptimistic('ALF-2', true));
        });

        await act(async () => {
          await result.current.actions.commitMoveInProject('ALF-2', true, applied.priorityBefore);
        });

        expect(prioritiesById(result.current.backlog)).toEqual({ i1: 10, i2: 30, i3: 5, i4: 40 });
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

    describe('the patchProject reducer action', () => {
      it('patches the matching project and leaves its siblings alone', () => {
        const next = codeReducer(
          { projects: [PROJECT_A, PROJECT_B], epics: [], stories: [] },
          { type: 'patchProject', id: 'p2', patch: { description: 'Described' } },
        );

        expect(next.projects[0]?.description).toBeNull();
        expect(next.projects[1]?.description).toBe('Described');
      });

      it('is a no-op for an id no longer in the list (the race rule)', () => {
        const before = { projects: [PROJECT_A], epics: [], stories: [] };

        const next = codeReducer(before, {
          type: 'patchProject',
          id: 'gone',
          patch: { description: 'Described' },
        });

        expect(next.projects).toStrictEqual([PROJECT_A]);
      });
    });

    describe('updateProjectDescription (board header inline edit)', () => {
      it('optimistically patches the description, then reconciles with the saved row', async () => {
        mockUpdateProject.mockResolvedValue({ ...PROJECT_A, description: 'Saved by the server.' });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A] }),
        });

        await act(async () => {
          await result.current.actions.updateProjectDescription('p1', 'My task system.');
        });

        expect(mockUpdateProject).toHaveBeenCalledWith('p1', { description: 'My task system.' });
        expect(result.current.board.project?.description).toBe('Saved by the server.');
      });

      it('applies the description before the request resolves', () => {
        mockUpdateProject.mockReturnValue(new Promise<Project>(() => {}));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A] }),
        });

        act(() => {
          void result.current.actions.updateProjectDescription('p1', 'My task system.');
        });

        expect(result.current.board.project?.description).toBe('My task system.');
      });

      it('clears the description with null', async () => {
        const described: Project = { ...PROJECT_A, description: 'The original.' };
        mockUpdateProject.mockResolvedValue({ ...described, description: null });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [described] }),
        });

        await act(async () => {
          await result.current.actions.updateProjectDescription('p1', null);
        });

        expect(mockUpdateProject).toHaveBeenCalledWith('p1', { description: null });
        expect(result.current.board.project?.description).toBeNull();
      });

      it('restores the previous description and toasts on failure', async () => {
        mockUpdateProject.mockRejectedValue(new Error('patch failed'));
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [{ ...PROJECT_A, description: 'The original.' }] }),
        });

        await act(async () => {
          await expect(
            result.current.actions.updateProjectDescription('p1', 'Replaced'),
          ).rejects.toThrow('patch failed');
        });

        expect(result.current.board.project?.description).toBe('The original.');
        expect(mockShowToast).toHaveBeenCalledWith("Couldn't save the project description");
      });

      it('throws when the project is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A] }),
        });

        await act(async () => {
          await expect(
            result.current.updateProjectDescription('missing', 'Described'),
          ).rejects.toThrow(/not found/i);
        });
        expect(mockUpdateProject).not.toHaveBeenCalled();
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

      it('writes in_development AND records the mark for a bypass launch', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'in_development', requires_refinement: false }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          title: 'Bump the compat date',
          factory_state: 'needs_refinement',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.openClaudeSession('ALF-42', 'bypass');
        });

        // Skipping refinement IS the judgement the mark records, so both routes leave the
        // same row — the chip just also opens a tab.
        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_development', {
          requires_refinement: false,
        });
        expect(findStoryState(result.current.board)).toBe('in_development');
        expect(findStory(result.current.board)?.requires_refinement).toBe(false);
        expect(openSpy).toHaveBeenCalledTimes(1);
        const prompt = mockCopyToClipboard.mock.calls[0]?.[0] ?? '';
        expect(prompt).toContain('SKIP-REFINEMENT');
      });

      it('opens the SKIP-REFINEMENT prompt for a ready_for_dev story with no committed spec', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'in_development' }),
        );
        // The state the refinement mark leaves a story in: Ready for Dev, no spec.
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_dev',
          spec_path: null,
          requires_refinement: false,
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.openClaudeSession('ALF-42', 'implementation');
        });

        const prompt = mockCopyToClipboard.mock.calls[0]?.[0] ?? '';
        expect(prompt).toContain('SKIP-REFINEMENT');
        expect(prompt).not.toMatch(/merged spec/i);
      });

      it('opens the spec-reading prompt for a ready_for_dev story that HAS a spec', async () => {
        mockUpdateCodeState.mockResolvedValue(
          makeSavedSidecar({ factory_state: 'in_development' }),
        );
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'ready_for_dev',
          spec_path: 'docs/specs/ALF-42.html',
        });
        const { result } = renderHook(() => useStore('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await result.current.actions.openClaudeSession('ALF-42', 'implementation');
        });

        const prompt = mockCopyToClipboard.mock.calls[0]?.[0] ?? '';
        expect(prompt).toMatch(/merged spec/i);
        expect(prompt).toContain('docs/specs/ALF-42.html');
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

      it('copies the launch prompt to the clipboard and confirms it with a toast', async () => {
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

        // The copied text is the decoded prompt the link would prefill — same text, not the URL.
        const copied = mockCopyToClipboard.mock.calls[0]?.[0] ?? '';
        expect(copied).toContain('ALF-42: Wire the webhook');
        expect(copied).not.toContain('https://claude.ai/code');
        expect(mockShowToast).toHaveBeenCalledWith('Prompt copied to clipboard');
        // Still opens the tab — the copy is a fallback, not a replacement.
        expect(openSpy).toHaveBeenCalledTimes(1);
      });

      it('opens the tab but shows NO copied toast when the clipboard write fails', async () => {
        mockCopyToClipboard.mockResolvedValue(false);
        mockUpdateCodeState.mockResolvedValue(makeSavedSidecar({ factory_state: 'in_refinement' }));
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

        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(mockShowToast).not.toHaveBeenCalledWith('Prompt copied to clipboard');
      });

      it('does not copy when the state write fails (nothing half-done)', async () => {
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

        expect(mockCopyToClipboard).not.toHaveBeenCalled();
      });
    });

    describe('openEpicSession (the epic launch — no state write)', () => {
      let openSpy: jest.SpiedFunction<typeof globalThis.open>;
      beforeEach(() => {
        openSpy = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
      });
      afterEach(() => {
        openSpy.mockRestore();
      });

      const epic = makeEpic('e1', 'p1', {
        ref: 'ALF-12',
        ref_number: 12,
        name: 'Communication Firewall',
      });

      it('opens the epic-refinement url built from the epic and its project', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await result.current.openEpicSession('e1');
        });

        expect(openSpy).toHaveBeenCalledTimes(1);
        const [url, target] = openSpy.mock.calls[0] ?? [];
        const opened = typeof url === 'string' ? url : (url?.toString() ?? '');
        expect(opened).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
        const prompt = new URL(opened).searchParams.get('q') ?? '';
        expect(prompt).toContain('ALF-12: Communication Firewall');
        expect(prompt).toContain('phase: epic-refinement');
        expect(target).toBe('_blank');
      });

      it('writes NO state — an epic has no lifecycle to advance', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await result.current.openEpicSession('e1');
        });

        expect(mockUpdateCodeState).not.toHaveBeenCalled();
        expect(mockUpdateEpic).not.toHaveBeenCalled();
      });

      it('copies the prompt to the clipboard and confirms it with a toast', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await result.current.openEpicSession('e1');
        });

        const copied = mockCopyToClipboard.mock.calls[0]?.[0] ?? '';
        expect(copied).toContain('ALF-12: Communication Firewall');
        expect(copied).not.toContain('https://claude.ai/code');
        expect(mockShowToast).toHaveBeenCalledWith('Prompt copied to clipboard');
      });

      it('opens the tab but shows NO copied toast when the clipboard write fails', async () => {
        mockCopyToClipboard.mockResolvedValue(false);
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await result.current.openEpicSession('e1');
        });

        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(mockShowToast).not.toHaveBeenCalledWith('Prompt copied to clipboard');
      });

      it('throws (and opens nothing) when the epic is not in the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [], stories: [] }),
        });

        await act(async () => {
          await expect(result.current.openEpicSession('gone')).rejects.toThrow(/not found/i);
        });
        expect(openSpy).not.toHaveBeenCalled();
      });

      it('throws when the epic’s project is missing from the store', async () => {
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [], epics: [epic], stories: [] }),
        });

        await act(async () => {
          await expect(result.current.openEpicSession('e1')).rejects.toThrow(/not found|missing/i);
        });
        expect(openSpy).not.toHaveBeenCalled();
      });
    });

    // ALF-33 — every write action surfaces a human-readable toast (never the raw error) when
    // its API call rejects, in addition to rolling the optimistic change back and re-throwing.
    describe('error toasts', () => {
      const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

      it('createProject toasts "Couldn\'t create project"', async () => {
        mockCreateProject.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [] }),
        });

        await act(async () => {
          await expect(
            result.current.createProject({ name: 'X', github_url: 'https://x', key: 'X' }),
          ).rejects.toThrow('boom');
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't create project");
      });

      it('createEpic toasts "Couldn\'t create epic"', async () => {
        mockCreateEpic.mockRejectedValue(new Error('nope'));
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A] }),
        });

        await act(async () => {
          await expect(result.current.createEpic('p1', 'Doomed')).rejects.toThrow('nope');
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't create epic");
      });

      it('convertTaskToCode toasts "Couldn\'t send to Code module"', async () => {
        mockEnterCodeModule.mockRejectedValue(new Error('gate failed'));
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        await act(async () => {
          await expect(
            result.current.convertTaskToCode(
              { id: 'task-1', title: 'X', notes: null, source_url: null },
              'p1',
              'e1',
            ),
          ).rejects.toThrow('gate failed');
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't send to Code module");
      });

      it('createStory toasts "Couldn\'t create story"', async () => {
        mockCreateCodeStory.mockRejectedValue(new Error('create failed'));
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
        });

        await act(async () => {
          await expect(result.current.createStory('e1', 'New', null, true)).rejects.toThrow(
            'create failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't create story");
      });

      it('updateCodeState toasts "Couldn\'t update story"', async () => {
        mockUpdateCodeState.mockRejectedValue(new Error('patch failed'));
        const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42' });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.updateCodeState('ALF-42', 'in_development')).rejects.toThrow(
            'patch failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't update story");
      });

      it('moveStoryToEpic toasts "Couldn\'t move story"', async () => {
        mockMoveCodeEpic.mockRejectedValue(new Error('move failed'));
        const e2 = makeEpic('e2', 'p1', { ref: 'ALF-2' });
        const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42' });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic, e2], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.moveStoryToEpic('ALF-42', 'e2')).rejects.toThrow(
            'move failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't move story");
      });

      it('updateEpic toasts "Couldn\'t save epic"', async () => {
        mockUpdateEpic.mockRejectedValue(new Error('patch failed'));
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [makeEpic('e1', 'p1')] }),
        });

        await act(async () => {
          await expect(result.current.updateEpic('e1', { name: 'New' })).rejects.toThrow(
            'patch failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't save epic");
      });

      it('updateStoryTitle toasts "Couldn\'t save title"', async () => {
        mockUpdateItem.mockRejectedValue(new Error('rename failed'));
        const story = makeStory('i1', 'e1', 'p1', { title: 'Old' });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.updateStoryTitle('i1', 'New')).rejects.toThrow(
            'rename failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't save title");
      });

      it('updateStoryNotes toasts "Couldn\'t save notes"', async () => {
        mockUpdateItem.mockRejectedValue(new Error('notes failed'));
        const story = makeStory('i1', 'e1', 'p1', { notes: 'Old' });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.updateStoryNotes('i1', 'New')).rejects.toThrow(
            'notes failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't save notes");
      });

      it('openClaudeSession toasts "Couldn\'t start session" when the state write fails', async () => {
        mockUpdateCodeState.mockRejectedValue(new Error('write failed'));
        const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42' });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        await act(async () => {
          await expect(result.current.openClaudeSession('ALF-42', 'refinement')).rejects.toThrow(
            'write failed',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't start session");
      });

      it('commitReorderBatch toasts "Couldn\'t reorder story"', async () => {
        mockReorderCode.mockRejectedValue(new Error('swap failed'));
        const high = makeStory('i1', 'e1', 'p1', { ref: 'ALF-1', priority: 1 });
        const low = makeStory('i2', 'e1', 'p1', { ref: 'ALF-2', priority: 2 });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [high, low] }),
        });

        let step!: NonNullable<ReturnType<CodeActions['applyReorderOptimistic']>>;
        act(() => {
          step = unwrap(result.current.applyReorderOptimistic('ALF-1', 'ALF-2'));
        });

        await act(async () => {
          await result.current.commitReorderBatch([step]);
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't reorder story");
      });

      it('commitMove toasts "Couldn\'t move story"', async () => {
        mockMoveCode.mockRejectedValue(new Error('move failed'));
        const high = makeStory('i1', 'e1', 'p1', { ref: 'ALF-1', priority: 1 });
        const low = makeStory('i2', 'e1', 'p1', { ref: 'ALF-2', priority: 2 });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [high, low] }),
        });

        let applied!: NonNullable<ReturnType<CodeActions['applyMoveOptimistic']>>;
        act(() => {
          applied = unwrap(result.current.applyMoveOptimistic('ALF-1', true));
        });

        await act(async () => {
          await result.current.commitMove('ALF-1', true, applied.priorityBefore);
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't move story");
      });

      it('commitMoveInProject toasts "Couldn\'t move story"', async () => {
        mockMoveCodeInProject.mockRejectedValue(new Error('move failed'));
        const high = makeStory('i1', 'e1', 'p1', { ref: 'ALF-1', priority: 1 });
        const low = makeStory('i2', 'e1', 'p1', { ref: 'ALF-2', priority: 2 });
        const { result } = renderHook(() => useCodeActions(), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [high, low] }),
        });

        let applied!: NonNullable<ReturnType<CodeActions['applyMoveInProjectOptimistic']>>;
        act(() => {
          applied = unwrap(result.current.applyMoveInProjectOptimistic('ALF-1', true));
        });

        await act(async () => {
          await result.current.commitMoveInProject('ALF-1', true, applied.priorityBefore);
        });

        expect(mockShowToast).toHaveBeenCalledWith("Couldn't move story");
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
        blocked_from: 'in_development',
        requires_refinement: false,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-02-02T00:00:00Z',
        priority: 9,
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
        blocked_from: 'in_development',
        requires_refinement: false,
        code_created_at: '2025-01-01T00:00:00Z',
        code_updated_at: '2025-02-02T00:00:00Z',
        priority: 9,
      });
    });
  });

  describe('refreshStatuses (ALF-69 navigation refetch)', () => {
    const epic = makeEpic('e1', 'p1', { ref: 'ALF-1', ref_number: 1 });

    it('patches each seeded story to its freshly-fetched factory_state', async () => {
      mockListCode.mockResolvedValue([
        makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'done' }),
      ]);
      const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'in_refinement' });
      const { result } = renderHook(() => useStore('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });
      expect(findStoryState(result.current.board)).toBe('in_refinement');

      await act(async () => {
        await result.current.actions.refreshStatuses();
      });

      expect(mockListCode).toHaveBeenCalledTimes(1);
      expect(findStoryState(result.current.board)).toBe('done');
    });

    it('reconciles the status companions (lane, blocked_reason) alongside the state', async () => {
      mockListCode.mockResolvedValue([
        makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'blocked',
          lane: 'local',
          blocked_reason: 'checks failing',
        }),
      ]);
      const story = makeStory('i1', 'e1', 'p1', {
        ref: 'ALF-42',
        factory_state: 'in_development',
        lane: 'human',
        blocked_reason: null,
        blocked_from: null,
      });
      const { result } = renderHook(() => useStore('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      await act(async () => {
        await result.current.actions.refreshStatuses();
      });

      const refreshed = findStory(result.current.board);
      expect(refreshed?.factory_state).toBe('blocked');
      expect(refreshed?.lane).toBe('local');
      expect(refreshed?.blocked_reason).toBe('checks failing');
    });

    it('leaves non-status fields (title, priority, notes) untouched', async () => {
      mockListCode.mockResolvedValue([
        makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'done',
          title: 'Renamed elsewhere',
          priority: 99,
        }),
      ]);
      const story = makeStory('i1', 'e1', 'p1', {
        ref: 'ALF-42',
        factory_state: 'in_refinement',
        title: 'Local title',
        priority: 1,
      });
      const { result } = renderHook(() => useStore('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      await act(async () => {
        await result.current.actions.refreshStatuses();
      });

      const refreshed = findStory(result.current.board);
      expect(refreshed?.factory_state).toBe('done');
      expect(refreshed?.title).toBe('Local title');
      expect(refreshed?.priority).toBe(1);
    });

    it('ignores a fetched story absent from the store (statuses only, no insert)', async () => {
      mockListCode.mockResolvedValue([
        makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'done' }),
        makeStory('new', 'e1', 'p1', { ref: 'ALF-99', factory_state: 'ready_for_dev' }),
      ]);
      const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'in_refinement' });
      const { result } = renderHook(() => useStore('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      await act(async () => {
        await result.current.actions.refreshStatuses();
      });

      const stories = result.current.board.activeEpics.flatMap((b) =>
        b.lanes.flatMap((l) => l.stories),
      );
      expect(stories.map((s) => s.item_id)).toEqual(['i1']);
      expect(findStoryState(result.current.board)).toBe('done');
    });

    it('swallows a failed fetch and leaves the seeded status intact', async () => {
      mockListCode.mockRejectedValue(new Error('network down'));
      const story = makeStory('i1', 'e1', 'p1', { ref: 'ALF-42', factory_state: 'in_refinement' });
      const { result } = renderHook(() => useStore('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      await act(async () => {
        await result.current.actions.refreshStatuses();
      });

      expect(findStoryState(result.current.board)).toBe('in_refinement');
      expect(mockShowToast).not.toHaveBeenCalled();
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

    it('tears BOTH channels down on unmount (code_items and epics)', () => {
      const { unmount } = renderHook(() => useProjectBoard('p1'), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic] }),
      });
      unmount();
      expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
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

        // The toast deep-links to the moved story's board modal, so the alert is the way there.
        expect(mockShowToast).toHaveBeenCalledWith(
          'ALF-42 moved to Ready for Dev',
          'emphasis',
          '/code/p1?story=ALF-42',
        );
      });

      it('deep-links the toast to the story board of the project the row belongs to', () => {
        // A move can land for a story on ANOTHER project's board (the subscription is global),
        // so the link follows the incoming row's project, not the board being viewed.
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'in_refinement',
        });
        renderHook(() => useProjectBoard('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        emitUpdate(
          makeSavedSidecar({
            item_id: 'i1',
            project_id: 'p9',
            ref: 'ALF-42',
            factory_state: 'ready_for_dev',
          }),
        );

        expect(mockShowToast).toHaveBeenCalledWith(
          'ALF-42 moved to Ready for Dev',
          'emphasis',
          '/code/p9?story=ALF-42',
        );
      });

      // The Worker moves a story on each PR event of the implementation phase; those alerts are
      // the ones that land while the user is elsewhere, so each has to be a way back to the card.
      it.each([
        ['ready_for_review', 'Ready for Review'],
        ['done', 'Done'],
      ] as const)('deep-links the toast for the PR-driven move to %s', (state, label) => {
        const story = makeStory('i1', 'e1', 'p1', {
          ref: 'ALF-42',
          factory_state: 'in_development',
        });
        renderHook(() => useProjectBoard('p1'), {
          wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
        });

        emitUpdate(makeSavedSidecar({ item_id: 'i1', ref: 'ALF-42', factory_state: state }));

        expect(mockShowToast).toHaveBeenCalledWith(
          `ALF-42 moved to ${label}`,
          'emphasis',
          '/code/p1?story=ALF-42',
        );
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

        expect(mockShowToast).toHaveBeenCalledWith(
          'ALF-42 moved to Blocked',
          'emphasis',
          '/code/p1?story=ALF-42',
        );
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

    // ALF-61: the board's Review PR chip is a pure function of the live story row, so a PR url
    // arriving out of band (the webhook Worker writes it, a realtime UPDATE delivers it) must
    // surface the chip with no page refresh — nothing but the store patch drives the re-render.
    it('surfaces the Review PR chip live when a realtime UPDATE delivers the pr url', () => {
      const prUrl = 'https://github.com/ac3charland/alfred/pull/61';
      const story = makeStory('i1', 'e1', 'p1', {
        ref: 'ALF-42',
        factory_state: 'in_refinement',
        refinement_pr_url: null,
      });

      render(<BoardCards />, {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [story] }),
      });

      // No chip yet: the session is running but hasn't opened its spec PR.
      expect(screen.queryByRole('link', { name: /review pr/i })).not.toBeInTheDocument();

      emitUpdate(
        makeSavedSidecar({
          item_id: 'i1',
          ref: 'ALF-42',
          factory_state: 'in_refinement',
          refinement_pr_url: prUrl,
        }),
      );

      const link = screen.getByRole('link', { name: /review pr/i });
      expect(link).toHaveAttribute('href', prUrl);
    });
  });

  // The Worker snapshots a merged epic spec onto the `epics` row out of band, so an open board
  // needs the push channel to show it without a reload.
  describe('realtime epics subscription', () => {
    const epic = makeEpic('e1', 'p1', { ref: 'ALF-12', ref_number: 12 });

    it('patches the spec columns onto the epic on a simulated UPDATE', () => {
      const { result } = renderHook(() => useEpics(), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
      });
      expect(result.current[0]?.spec_path).toBeNull();

      emitEpicUpdate({
        ...epic,
        spec_path: 'docs/specs/epics/ALF-12.html',
        spec_sha: 'blobsha',
        spec_markdown: '<!doctype html><html><body>Epic plan</body></html>',
        refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/12',
      });

      expect(result.current[0]).toMatchObject({
        spec_path: 'docs/specs/epics/ALF-12.html',
        spec_sha: 'blobsha',
        spec_markdown: '<!doctype html><html><body>Epic plan</body></html>',
        refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/12',
      });
    });

    it('fires no toast — nothing visibly moves on the board for an epic spec', () => {
      renderHook(() => useEpics(), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
      });

      emitEpicUpdate({ ...epic, spec_path: 'docs/specs/epics/ALF-12.html' });

      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('ignores an UPDATE for an epic id not in the store (no resurrection)', () => {
      const { result } = renderHook(() => useEpics(), {
        wrapper: makeWrapper({ projects: [PROJECT_A], epics: [epic], stories: [] }),
      });

      emitEpicUpdate({ ...epic, id: 'gone', spec_path: 'docs/specs/epics/ALF-99.html' });

      expect(result.current).toHaveLength(1);
      expect(result.current[0]?.spec_path).toBeNull();
    });

    it('leaves the epic’s own editable fields alone (only spec columns are patched)', () => {
      // The realtime row is the Worker's write; a local rename in flight must not be clobbered
      // by a stale name riding along on the payload.
      const { result } = renderHook(() => useEpics(), {
        wrapper: makeWrapper({
          projects: [PROJECT_A],
          epics: [makeEpic('e1', 'p1', { ref: 'ALF-12', name: 'Renamed locally' })],
          stories: [],
        }),
      });

      emitEpicUpdate({ ...epic, name: 'Stale name', spec_path: 'docs/specs/epics/ALF-12.html' });

      expect(result.current[0]?.name).toBe('Renamed locally');
      expect(result.current[0]?.spec_path).toBe('docs/specs/epics/ALF-12.html');
    });
  });
});
