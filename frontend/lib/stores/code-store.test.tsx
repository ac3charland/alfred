import { renderHook } from '@testing-library/react';
import * as React from 'react';

import type { CodeStory, Epic, Project } from '@/lib/types';

import {
  CodeProvider,
  HAPPY_PATH_STATES,
  isEscapeState,
  useCodeActions,
  useProjectBoard,
  useProjects,
} from './code-store';

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

  describe('useCodeActions (M4–M6 seam)', () => {
    it('is wired but inert (ready: false) in M3', () => {
      const { result } = renderHook(() => useCodeActions(), {
        wrapper: makeWrapper({}),
      });
      expect(result.current.ready).toBe(false);
    });
  });
});
