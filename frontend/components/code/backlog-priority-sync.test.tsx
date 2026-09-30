import { act, fireEvent, screen } from '@testing-library/react';
import * as React from 'react';

import { BacklogList } from '@/components/code/backlog/backlog-list';
import * as api from '@/lib/api-client';
import { stableSorted } from '@/lib/sort';
import { DEFAULT_BACKLOG_STATUSES, useBacklog } from '@/lib/stores/code-store';
import { renderWithProviders } from '@/lib/test-utils';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

/**
 * ALF-250's property test: whatever order the network hands replies and realtime echoes back in,
 * the Backlog never shows anything but the order the owner has clicked it into, and the server
 * ends there too. A fake server runs each priority RPC exactly as the SQL does (one write per
 * story, each stamped with the next revision), replies after a random delay, and streams every
 * row it wrote back through the realtime handler — in commit order, as Realtime does, but at a
 * random lag that can trail later replies. Swaps and both kinds of jump land at random rows at
 * random intervals, on a project-filtered Backlog with another project's stories ranked between
 * the visible ones. Some project jumps run out of float room and respace every story's rank
 * first, as `move_code_priority_in_project` does, so a rank the tab hears can be on a new scale —
 * and, as the RPC does, they reply with every story's rank, not just the moved one's, so a reply
 * that lands before its echoes never leaves the tab on two scales.
 */

jest.mock('@/lib/api-client');
const mockReorderCode = jest.mocked(api.reorderCode);
const mockMoveCode = jest.mocked(api.moveCode);
const mockMoveCodeInProject = jest.mocked(api.moveCodeInProject);

let mockCodeItemsHandler: ((payload: { new: CodeItem }) => void) | undefined;
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
        if (filter.table === 'code_items') {
          mockCodeItemsHandler = handler as (payload: { new: CodeItem }) => void;
        }
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      realtime: { setAuth: () => Promise.resolve() },
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
    };
  },
}));

const ALFRED: Project = {
  color: null,
  description: null,
  exclude_from_pr_ratio: false,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 1,
  created_at: '2025-01-01T00:00:00Z',
};
const RELAY: Project = { ...ALFRED, id: 'p2', key: 'RLP', name: 'Relay', repo_name: 'relay' };
const ALFRED_EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Backlog',
  notes: null,
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};
const RELAY_EPIC: Epic = { ...ALFRED_EPIC, id: 'e2', project_id: 'p2', ref: 'RLP-1' };

function makeStory(ref: string, projectId: string, priority: number): CodeStory {
  return {
    item_id: ref,
    project_id: projectId,
    epic_id: projectId === 'p1' ? 'e1' : 'e2',
    ref_number: 1,
    ref,
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
    title: ref,
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: projectId === 'p1' ? 'ALF' : 'RLP',
    project_name: projectId === 'p1' ? 'Alfred' : 'Relay',
    repo_owner: 'ac3charland',
    repo_name: projectId === 'p1' ? 'alfred' : 'relay',
    epic_name: 'Backlog',
    epic_ref: projectId === 'p1' ? 'ALF-1' : 'RLP-1',
    epic_archived_at: null,
    epic_spec_path: null,
    priority,
  };
}

function makeSidecar(ref: string, projectId: string, priority: number, rev: number): CodeItem {
  return {
    item_id: ref,
    project_id: projectId,
    epic_id: projectId === 'p1' ? 'e1' : 'e2',
    ref_number: 1,
    ref,
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
    created_at: '2025-01-01T00:00:00Z',
    done_at: null,
    updated_at: '2025-01-01T00:00:00Z',
    priority,
    priority_rev: rev,
  };
}

/** A small seeded generator, so every run replays the same timings and clicks. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/** The Backlog narrowed to the Alfred project, as the owner had it when ALF-250 bit. */
function AlfredBacklog() {
  const stories = useBacklog({ statuses: DEFAULT_BACKLOG_STATUSES, projectIds: ['p1'] });
  return <BacklogList stories={stories} emptyMessage="No stories" />;
}

function rowOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /^Move \S+ up$/ })
    .map((button) => /^Move (\S+) up$/.exec(button.getAttribute('aria-label') ?? '')?.[1] ?? '');
}

type Click =
  | 'up'
  | 'down'
  | 'to top of project'
  | 'to bottom of project'
  | 'to top of list'
  | 'to bottom of list';

/** Where a click leaves the visible list, when the screen is showing `order`. */
function clicked(order: string[], index: number, click: Click): string[] {
  const next = [...order];
  const [ref] = next.splice(index, 1);
  if (ref === undefined) return order;
  const target = {
    up: index - 1,
    down: index + 1,
    'to top of project': 0,
    'to bottom of project': next.length,
    'to top of list': 0,
    'to bottom of list': next.length,
  }[click];
  next.splice(target, 0, ref);
  return next;
}

/** One seeded session of clicks against the fake server. Returns every disagreement it saw. */
async function runSession(seed: number): Promise<string[]> {
  const random = seededRandom(seed);
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low));

  // Six Alfred stories, with a Relay story ranked between some of them.
  const stories: CodeStory[] = [];
  for (let index = 0; index < 6; index += 1) {
    stories.push(makeStory(`ALF-${String(200 + index)}`, 'p1', stories.length + 1));
    if (random() < 0.5) {
      stories.push(makeStory(`RLP-${String(200 + index)}`, 'p2', stories.length + 1));
    }
  }
  const projectOf = new Map(stories.map((story) => [story.ref ?? '', story.project_id ?? '']));
  const server = new Map(stories.map((story) => [story.ref ?? '', story.priority ?? 0]));
  // The server's own dice, apart from the clicks' and the network's, so which jumps respace
  // doesn't reshuffle either.
  const serverRandom = seededRandom(seed * 7919 + 1);
  let lastEchoAt = 0;
  // `code_items.priority_rev`: every committed rank gets the next revision, as the trigger does.
  let revision = 0;

  /**
   * Commit `run()`'s writes (in commit order) after a delay, echo every one of them in that
   * order, and reply with each story it wrote at its latest write — a story a respace renumbered
   * and the jump then moved is echoed twice but replied once, at the rank it ended on.
   */
  function respond(run: () => [string, number][]): Promise<CodeItem[]> {
    return new Promise((resolve) => {
      setTimeout(
        () => {
          const rows = run().map(([ref, priority]) => {
            server.set(ref, priority);
            revision += 1;
            return makeSidecar(ref, projectOf.get(ref) ?? '', priority, revision);
          });
          const replied = [...new Map(rows.map((row) => [row.item_id, row])).values()];
          const echoAt = Math.max(lastEchoAt + 1, Date.now() + between(0, 600));
          lastEchoAt = echoAt;
          setTimeout(() => {
            for (const row of rows) mockCodeItemsHandler?.({ new: row });
          }, echoAt - Date.now());
          setTimeout(
            () => {
              resolve(replied);
            },
            between(10, 150),
          );
        },
        between(20, 200),
      );
    });
  }

  const others = (ref: string) => [...server].filter(([other]) => other !== ref);
  /**
   * `respace_code_priorities()`: every story's rank becomes 1..N in the order they stand. The
   * update names `priority` on every row, so each one is stamped and streams back, changed or not.
   */
  function respace(): [string, number][] {
    const writes = stableSorted([...server], ([, a], [, b]) => a - b).map(
      ([ref], index): [string, number] => [ref, index + 1],
    );
    for (const [ref, priority] of writes) server.set(ref, priority);
    return writes;
  }
  mockReorderCode.mockImplementation((a, b) =>
    respond(() => [
      [a, server.get(b) ?? 0],
      [b, server.get(a) ?? 0],
    ]),
  );
  mockMoveCodeInProject.mockImplementation((ref, toTop) =>
    respond(() => {
      // Some jumps find no float room and respace first, then land against the ranks it wrote.
      const before = serverRandom() < 0.5 ? respace() : [];
      const all = others(ref).map(([, priority]) => priority);
      const project = others(ref)
        .filter(([other]) => projectOf.get(other) === projectOf.get(ref))
        .map(([, priority]) => priority);
      const extreme = toTop ? Math.min(...project) : Math.max(...project);
      const beyond = all.filter((priority) => (toTop ? priority < extreme : priority > extreme));
      const neighbour = toTop ? Math.max(...beyond) : Math.min(...beyond);
      let landed = (neighbour + extreme) / 2;
      if (beyond.length === 0) landed = toTop ? extreme - 1 : extreme + 1;
      return [...before, [ref, landed]];
    }),
  );
  mockMoveCode.mockImplementation((ref, toTop) =>
    respond(() => {
      const all = others(ref).map(([, priority]) => priority);
      return [[ref, toTop ? Math.min(...all) - 1 : Math.max(...all) + 1]];
    }),
  );

  const view = renderWithProviders(<AlfredBacklog />, {
    projects: [ALFRED, RELAY],
    epics: [ALFRED_EPIC, RELAY_EPIC],
    stories,
  });

  const disagreements: string[] = [];
  let intended = rowOrder();
  for (let step = 0; step < 12; step += 1) {
    const shown = rowOrder();
    if (shown.join(',') !== intended.join(',')) {
      disagreements.push(`before click ${String(step)}: shows ${shown.join(',')}`);
      intended = shown;
    }
    const index = between(0, shown.length);
    const clicks: Click[] = [
      ...(index > 0 ? (['up', 'to top of project', 'to top of list'] as const) : []),
      ...(index < shown.length - 1
        ? (['down', 'to bottom of project', 'to bottom of list'] as const)
        : []),
    ];
    const click = clicks[between(0, clicks.length)] ?? 'down';
    fireEvent.click(screen.getByRole('button', { name: `Move ${shown[index] ?? ''} ${click}` }));
    intended = clicked(intended, index, click);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(between(0, 900));
    });
  }
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
  });

  const serverOrder = stableSorted(
    [...server].filter(([ref]) => projectOf.get(ref) === 'p1'),
    ([, a], [, b]) => a - b,
  ).map(([ref]) => ref);
  if (rowOrder().join(',') !== intended.join(',')) {
    disagreements.push(`at rest: shows ${rowOrder().join(',')}`);
  }
  if (serverOrder.join(',') !== intended.join(',')) {
    disagreements.push(`at rest: server holds ${serverOrder.join(',')}`);
  }
  view.unmount();
  return disagreements.map((line) => `${line}, clicked into ${intended.join(',')}`);
}

describe('Backlog priority sync under any network timing (ALF-250)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(Array.from({ length: 12 }, (_, index) => index + 1))(
    'session %i: the screen and the server end where the clicks put them',
    async (seed) => {
      expect(await runSession(seed)).toEqual([]);
    },
  );
});
