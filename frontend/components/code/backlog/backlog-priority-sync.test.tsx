import { act, fireEvent, render } from '@testing-library/react';
import * as React from 'react';

import { BacklogList } from '@/components/code/backlog/backlog-list';
import * as api from '@/lib/api-client';
import { stableSorted } from '@/lib/sort';
import { CodeProvider, DEFAULT_BACKLOG_STATUSES, useBacklog } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

// ALF-250: the Backlog's priority controls must leave the list exactly where the user's clicks
// put it — on screen at every moment, and on the server once everything settles — however the
// clicks, the RPC round trips and the realtime echoes of those RPCs' writes interleave. These
// tests drive the real BacklogList + CodeProvider against an in-memory server that implements the
// ranking RPCs' semantics, with seeded random latency.

jest.mock('@/lib/api-client');
const mockReorderCode = jest.mocked(api.reorderCode);
const mockMoveCode = jest.mocked(api.moveCode);
const mockMoveCodeInProject = jest.mocked(api.moveCodeInProject);

// Capture the `code_items` realtime handler so the fake server can echo its writes through it.
let mockRealtimeHandler: ((payload: { new: CodeItem }) => void) | undefined;
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
        if (filter.table === 'code_items') {
          mockRealtimeHandler = handler as (payload: { new: CodeItem }) => void;
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

const PROJECTS: Project[] = ['p1', 'p2'].map((id, index) => ({
  color: null,
  description: null,
  id,
  name: id,
  key: index === 0 ? 'ALF' : 'RLP',
  repo_owner: 'ac3charland',
  repo_name: id,
  github_url: null,
  ref_seq: 1,
  created_at: `2025-01-0${String(index + 1)}T00:00:00Z`,
}));

const EPICS: Epic[] = PROJECTS.map((project) => ({
  id: `e-${project.id}`,
  project_id: project.id,
  name: 'Epic',
  notes: null,
  ref_number: 1,
  ref: `${project.key}-E`,
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
}));

interface Seed {
  ref: string;
  projectId: string;
  done?: boolean;
}

/** A Backlog interleaving two projects, plus a hidden done story the midpoint math must skip. */
const SEEDS: Seed[] = [
  { ref: 'ALF-1', projectId: 'p1' },
  { ref: 'RLP-1', projectId: 'p2' },
  { ref: 'ALF-2', projectId: 'p1' },
  { ref: 'ALF-9', projectId: 'p1', done: true },
  { ref: 'RLP-2', projectId: 'p2' },
  { ref: 'ALF-3', projectId: 'p1' },
  { ref: 'RLP-3', projectId: 'p2' },
  { ref: 'ALF-4', projectId: 'p1' },
];

function makeRow(seed: Seed, priority: number): CodeItem {
  return {
    item_id: `i-${seed.ref}`,
    project_id: seed.projectId,
    epic_id: `e-${seed.projectId}`,
    ref_number: 1,
    ref: seed.ref,
    factory_state: seed.done === true ? 'done' : 'in_development',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: false,
    created_at: '2025-01-01T00:00:00Z',
    done_at: null,
    updated_at: '2025-01-01T00:00:00Z',
    priority,
  };
}

function toStory(row: CodeItem): CodeStory {
  const project = PROJECTS.find((p) => p.id === row.project_id);
  return {
    item_id: row.item_id,
    project_id: row.project_id,
    epic_id: row.epic_id,
    ref_number: row.ref_number,
    ref: row.ref,
    factory_state: row.factory_state,
    lane: row.lane,
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: false,
    code_created_at: row.created_at,
    code_updated_at: row.updated_at,
    title: `Story ${row.ref}`,
    notes: null,
    source_url: null,
    item_created_at: row.created_at,
    project_key: project?.key ?? null,
    project_name: project?.name ?? null,
    repo_owner: 'ac3charland',
    repo_name: project?.repo_name ?? null,
    epic_name: 'Epic',
    epic_ref: `${project?.key ?? ''}-E`,
    epic_archived_at: null,
    epic_spec_path: null,
    priority: row.priority,
  };
}

/** The element at `index`, failing loudly instead of handing back `undefined`. */
function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

const seedOf = (ref: string) => SEEDS.find((seed) => seed.ref === ref);

/** A small seeded PRNG (mulberry32), so every failure names a reproducible seed. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = Math.trunc(state + 0x6d_2b_79_f5);
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The in-memory `code_items` table and the three ranking RPCs, mirroring the SQL: the swap
 * exchanges the two rows' CURRENT priorities; the jumps land past the extreme of the OTHER rows
 * (the project-scoped one at the midpoint with the nearest row beyond the project's outstanding
 * extreme). Each RPC applies when its request reaches the server, answers after the rest of the
 * round trip, and echoes every row it wrote over realtime, in commit order, after its own delay.
 */
function makeServer(random: () => number) {
  const rows = new Map(SEEDS.map((seed, index) => [seed.ref, makeRow(seed, (index + 1) * 10)]));
  let lastEchoAt = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const others = (ref: string) => [...rows.values()].filter((row) => row.ref !== ref);
  const rowOf = (ref: string): CodeItem => {
    const row = rows.get(ref);
    if (row === undefined) throw new Error(`no row ${ref}`);
    return row;
  };

  const write = (ref: string, priority: number): CodeItem => {
    const row = { ...rowOf(ref), priority };
    rows.set(ref, row);
    return row;
  };

  const rpc = (apply: () => CodeItem[]): Promise<CodeItem[]> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const arrive = Math.floor(random() * 150);
    const respond = arrive + Math.floor(random() * 150);
    return new Promise((resolve) => {
      setTimeout(() => {
        const written = apply();
        const echoAt = Math.max(lastEchoAt, Date.now() + Math.floor(random() * 400));
        lastEchoAt = echoAt;
        setTimeout(() => {
          for (const row of written) mockRealtimeHandler?.({ new: { ...row } });
        }, echoAt - Date.now());
        setTimeout(() => {
          inFlight -= 1;
          resolve(written.map((row) => ({ ...row })));
        }, respond - arrive);
      }, arrive);
    });
  };

  const swap = (a: string, b: string) =>
    rpc(() => {
      const aPriority = rowOf(a).priority;
      const bPriority = rowOf(b).priority;
      return [write(a, bPriority), write(b, aPriority)];
    });

  const move = (ref: string, toTop: boolean) =>
    rpc(() => {
      const priorities = others(ref).map((row) => row.priority);
      return [write(ref, toTop ? Math.min(...priorities) - 1 : Math.max(...priorities) + 1)];
    });

  const moveInProject = (ref: string, toTop: boolean) =>
    rpc(() => {
      const target = rowOf(ref);
      const all = others(ref).map((row) => row.priority);
      const project = others(ref)
        .filter((row) => row.project_id === target.project_id && row.factory_state !== 'done')
        .map((row) => row.priority);
      let next: number;
      if (toTop) {
        const extreme = Math.min(...project);
        const above = all.filter((p) => p < extreme);
        next = above.length === 0 ? extreme - 1 : (Math.max(...above) + extreme) / 2;
      } else {
        const extreme = Math.max(...project);
        const below = all.filter((p) => p > extreme);
        next = below.length === 0 ? extreme + 1 : (Math.min(...below) + extreme) / 2;
      }
      return [write(ref, next)];
    });

  return {
    rows,
    rowOf,
    swap,
    move,
    moveInProject,
    /** Every ref, best rank first. */
    order: () =>
      stableSorted([...rows.values()], (x, y) => x.priority - y.priority).map((row) => row.ref),
    maxInFlight: () => maxInFlight,
  };
}

/**
 * What the user expects, as a pure ORDER (no priorities): a swap trades two rows' places, a
 * Backlog jump sends the row to either end, and a project jump parks it right beside its
 * project's outstanding extreme.
 */
function applyIntent(order: string[], ref: string, action: string, neighbour?: string): string[] {
  if (action === 'up' || action === 'down') {
    const next = [...order];
    const i = next.indexOf(ref);
    const j = next.indexOf(neighbour ?? '');
    [next[i], next[j]] = [itemAt(next, j), itemAt(next, i)];
    return next;
  }
  const rest = order.filter((r) => r !== ref);
  if (action === 'top of list') return [ref, ...rest];
  if (action === 'bottom of list') return [...rest, ref];
  const peers = rest.filter(
    (r) => seedOf(r)?.projectId === seedOf(ref)?.projectId && seedOf(r)?.done !== true,
  );
  const anchor = action === 'top of project' ? peers[0] : peers.at(-1);
  const at = rest.indexOf(anchor ?? '') + (action === 'top of project' ? 0 : 1);
  return [...rest.slice(0, at), ref, ...rest.slice(at)];
}

/**
 * The rendered row order, read off each row's "Move <ref> up" chevron. (Plain selectors rather
 * than role queries: the fuzz reads the list hundreds of times.)
 */
function rowOrder(): string[] {
  return [...document.querySelectorAll('button[aria-label$=" up"]')].map(
    (button) => /^Move (\S+) up$/.exec(button.getAttribute('aria-label') ?? '')?.[1] ?? '',
  );
}

function controlFor(ref: string, label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="Move ${CSS.escape(ref)} ${CSS.escape(label)}"]`,
  );
  if (button === null) throw new Error(`no "${label}" control for ${ref}`);
  return button;
}

function Harness({ projectIds }: { projectIds?: string[] }) {
  const stories = useBacklog({
    statuses: DEFAULT_BACKLOG_STATUSES,
    ...(projectIds === undefined ? {} : { projectIds }),
  });
  return <BacklogList stories={stories} emptyMessage="empty" />;
}

const ACTIONS = [
  'up',
  'down',
  'top of project',
  'bottom of project',
  'top of list',
  'bottom of list',
] as const;

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Click randomly through the list, checking after every pause that the screen still shows the
 * order the clicks so far imply, then let everything settle and check the server agrees.
 */
async function fuzz(seed: number, projectIds?: string[]) {
  const random = prng(seed);
  const server = makeServer(random);
  mockReorderCode.mockImplementation((a, b) => server.swap(a, b));
  mockMoveCode.mockImplementation((ref, toTop) => server.move(ref, toTop));
  mockMoveCodeInProject.mockImplementation((ref, toTop) => server.moveInProject(ref, toTop));

  // Only the providers the Backlog reads: the full app tree polls other modules on timers this
  // test fast-forwards through.
  const { unmount } = render(
    <ToastProvider>
      <CodeProvider
        initialProjects={PROJECTS}
        initialEpics={EPICS}
        initialStories={[...server.rows.values()].map((row) => toStory(row))}
      >
        <Harness {...(projectIds === undefined ? {} : { projectIds })} />
      </CodeProvider>
    </ToastProvider>,
  );
  const visible = (order: string[]) =>
    order.filter((ref) => {
      const row = server.rowOf(ref);
      return (
        row.factory_state !== 'done' &&
        (projectIds === undefined || projectIds.includes(row.project_id))
      );
    });

  let intended = server.order();
  for (let step = 0; step < 30; step += 1) {
    const shown = rowOrder();
    const ref = itemAt(shown, Math.floor(random() * shown.length));
    const action = itemAt(ACTIONS, Math.floor(random() * ACTIONS.length));
    const label = action === 'up' || action === 'down' ? action : `to ${action}`;
    const button = controlFor(ref, label);
    if (!button.disabled) {
      const index = shown.indexOf(ref);
      const neighbour = action === 'up' ? shown[index - 1] : shown[index + 1];
      fireEvent.click(button);
      intended = applyIntent(intended, ref, action, neighbour);
    }
    // Sometimes a burst, sometimes a pause long enough for a sync to land.
    await advance(Math.floor(random() * 400));
    expect({ seed, step, order: rowOrder() }).toEqual({ seed, step, order: visible(intended) });
  }

  await advance(60_000);
  expect({ seed, order: rowOrder() }).toEqual({ seed, order: visible(intended) });
  expect({ seed, server: server.order() }).toEqual({ seed, server: intended });
  unmount();
  return server;
}

describe('Backlog priority sync (ALF-250)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRealtimeHandler = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the on-screen order where the clicks put it, and the server in step, across the whole Backlog', async () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const server = await fuzz(seed);
      // One ranking write in flight at a time: the swaps are order-dependent, so two overlapping
      // requests can land in a different order than the clicks that made them.
      expect({ seed, maxInFlight: server.maxInFlight() }).toEqual({ seed, maxInFlight: 1 });
    }
  });

  it('does the same in a project-filtered Backlog, where neighbours skip hidden rows', async () => {
    for (let seed = 101; seed <= 106; seed += 1) {
      await fuzz(seed, ['p1']);
    }
  });
});
