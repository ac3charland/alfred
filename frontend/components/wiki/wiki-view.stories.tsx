import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import type { WikiSearchHit } from '@/lib/types';
import {
  makeWikiSync,
  resetWikiFixtureClock,
  toWikiIndexRow,
  wikiFixtureSet,
} from '@/lib/wiki/fixtures';

import { WikiView } from './wiki-view';

/**
 * The Wiki module's reading room, one story per state the mockups draw: the index, a section,
 * both search moments, a page with every link kind and its backlinks, a page loading and failing,
 * not found, the empty snapshot and a failed sync. Seeded from the fixture set through
 * `parameters.store.wiki`; the body read and the body search are stubbed at `fetch`, since the
 * view reaches them through the store and the API client.
 */

/** The instant the header's relative times read against: two hours after the fixture sync. */
const NOW = new Date('2026-10-03T16:00:00.000Z');

const REPO = 'ac3charland/knowledge';

resetWikiFixtureClock();
const FIXTURES = wikiFixtureSet();
const INDEX = FIXTURES.pages.map((page) => toWikiIndexRow(page));

/** The body hits a search for "forgetting" gets: the curve (a title match too) and Brain Rules. */
const FORGETTING_HITS: WikiSearchHit[] = [
  {
    path: 'wiki/concepts/forgetting-curve.md',
    snippet: 'Recall decays exponentially; spaced review resets the curve each time.',
    rank: 0.6,
  },
  {
    path: 'wiki/sources/brain-rules.md',
    snippet:
      'Medina argues that \u0002forgetting\u0003 is the brain pruning what it was never asked to retrieve, so repetition matters more than intensity.',
    rank: 0.3,
  },
];

type Answer = 'pending' | 'fail' | { json: unknown };

function respond(answer: Answer): Promise<unknown> {
  if (answer === 'pending') return new Promise(() => {});
  if (answer === 'fail') {
    return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(answer.json),
    text: () => Promise.resolve(JSON.stringify(answer.json)),
  });
}

type BodyAnswer = 'ready' | 'pending' | 'fail';
type SearchAnswer = WikiSearchHit[] | 'pending' | 'fail';

/**
 * A `fetch` for the two reads the view makes on demand: a page body (answered from the fixture set
 * unless `body` says otherwise) and the body search. Every other request — the store's own
 * refresh, other modules' polls — never answers, so nothing re-seeds mid-capture.
 */
function wikiFetch(body: BodyAnswer, search: SearchAnswer): typeof fetch {
  // The API client always fetches a same-origin path string.
  return ((input: string) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/wiki/page') {
      const path = url.searchParams.get('path') ?? '';
      const page = FIXTURES.pages.find((candidate) => candidate.path === path);
      if (body !== 'ready' || page === undefined) return respond(body === 'ready' ? 'fail' : body);
      return respond({ json: { path, blob_oid: page.blob_oid, body: page.body } });
    }
    if (url.pathname === '/api/wiki/search') {
      return respond(Array.isArray(search) ? { json: search } : search);
    }
    return respond('pending');
  }) as unknown as typeof fetch;
}

/**
 * A story `beforeEach` that installs {@link wikiFetch} and puts the real `fetch` back when the
 * story unloads, so no later story inherits a stub that never answers (as `post-row.stories.tsx`).
 */
function stubWikiFetch({
  body = 'ready',
  search = 'pending',
}: { body?: BodyAnswer; search?: SearchAnswer } = {}): () => () => void {
  return () => {
    const original = globalThis.fetch;
    globalThis.fetch = wikiFetch(body, search);
    return () => {
      globalThis.fetch = original;
    };
  };
}

const withFrame: Decorator = (Story) => (
  <div data-testid="wiki-frame" className="w-[768px] bg-background p-6">
    <Story />
  </div>
);

const FRAME = { target: '[data-testid="wiki-frame"]' };

function at(pathname: string) {
  return { nextjs: { appDirectory: true, navigation: { pathname } } };
}

const meta = {
  title: 'Wiki/WikiView',
  component: WikiView,
  decorators: [withFrame],
  args: { now: NOW },
  parameters: {
    ...at('/wiki'),
    store: { wiki: { pages: INDEX, sync: FIXTURES.sync, repo: REPO } },
    visualTest: FRAME,
  },
} satisfies Meta<typeof WikiView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every page, grouped Concepts · Entities · Sources · Questions, each heading with its count. */
export const Index: Story = {
  beforeEach: stubWikiFetch(),
};

/** One section — the index filtered to Concepts. */
export const Section: Story = {
  beforeEach: stubWikiFetch(),
  parameters: at('/wiki/concepts'),
};

async function search(canvasElement: HTMLElement, query: string) {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByRole('searchbox', { name: 'Search the wiki' }), query);
  return canvas;
}

/** "forgetting": the title match is in; the body search is still out. */
export const SearchPending: Story = {
  beforeEach: stubWikiFetch({ search: 'pending' }),
  play: async ({ canvasElement }) => {
    const canvas = await search(canvasElement, 'forgetting');
    await expect(await canvas.findByText('Searching page text…')).toBeInTheDocument();
  },
};

/** "forgetting" with the body hits in: Brain Rules matched in its text, the word marked. */
export const SearchResults: Story = {
  beforeEach: stubWikiFetch({ search: FORGETTING_HITS }),
  play: async ({ canvasElement }) => {
    const canvas = await search(canvasElement, 'forgetting');
    await expect(
      await canvas.findByRole('link', { name: /Brain Rules/ }, { timeout: 3000 }),
    ).toBeInTheDocument();
  },
};

/** "zettelkasten": neither group finds a page. */
export const SearchNoMatch: Story = {
  beforeEach: stubWikiFetch({ search: [] }),
  play: async ({ canvasElement }) => {
    const canvas = await search(canvasElement, 'zettelkasten');
    await expect(
      await canvas.findByText('No pages match “zettelkasten”', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  },
};

/** "forgetting" with the body search failed: the title match stays, the failure is said. */
export const SearchFailed: Story = {
  beforeEach: stubWikiFetch({ search: 'fail' }),
  play: async ({ canvasElement }) => {
    const canvas = await search(canvasElement, 'forgetting');
    await expect(
      await canvas.findByText("Couldn't search page text", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  },
};

/** A page with every link kind in its body, its sources and its backlinks. */
export const Page: Story = {
  beforeEach: stubWikiFetch({ body: 'ready' }),
  parameters: at('/wiki/concepts/habit-stacking'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('heading', { name: 'Where the sources disagree' }),
    ).toHaveAttribute('id', 'where-the-sources-disagree');
  },
};

/** The header from the index while the body is still on its way. */
export const PageLoading: Story = {
  beforeEach: stubWikiFetch({ body: 'pending' }),
  parameters: at('/wiki/concepts/habit-stacking'),
};

/** The body read failed: the header stays, the body slot offers a retry. */
export const PageError: Story = {
  beforeEach: stubWikiFetch({ body: 'fail' }),
  parameters: at('/wiki/concepts/habit-stacking'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Couldn't load this page"),
    ).toBeInTheDocument();
  },
};

/** A path the snapshot doesn't hold. */
export const NotFound: Story = {
  beforeEach: stubWikiFetch(),
  parameters: at('/wiki/concepts/not-yet'),
};

/** Nothing has synced yet: no pages, no sync row. */
export const Empty: Story = {
  beforeEach: stubWikiFetch(),
  parameters: { store: { wiki: { pages: [], sync: null, repo: REPO } } },
};

/** The last sync failed after the last one that worked, with pages still pending. */
export const SyncFailed: Story = {
  beforeEach: stubWikiFetch(),
  parameters: {
    store: {
      wiki: {
        pages: INDEX,
        repo: REPO,
        sync: makeWikiSync({
          synced_at: '2026-10-01T16:00:00.000Z',
          pending: 12,
          last_error: 'GraphQL: rate limited',
          last_error_at: '2026-10-03T13:00:00.000Z',
        }),
      },
    },
  },
};
