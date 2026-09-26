import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { WikiImageLink, WikiLink, WikiMarkdown } from './wiki-markdown';

// react-markdown is pure ESM (see wiki-view.test.tsx). The mock records the props WikiMarkdown
// hands it, so the test can drive the `a` / `img` overrides and the heading-id plugin it passes.
const mockMarkdownProps = jest.fn<undefined, [unknown]>();
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: { children?: string }) => {
    mockMarkdownProps(props);
    return <div data-testid="markdown">{props.children}</div>;
  },
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

const PAGE = 'wiki/concepts/habit-stacking.md';
const REPO = 'ac3charland/knowledge';
const CONTEXT = {
  index: new Set([PAGE, 'wiki/concepts/habit-loop.md']),
  repo: REPO,
};

let pushState: jest.SpyInstance;

beforeEach(() => {
  pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WikiLink', () => {
  it('opens a page in the snapshot in-app, violet and underlined', async () => {
    render(
      <WikiLink href="habit-loop.md" fromPath={PAGE} context={CONTEXT}>
        the habit loop
      </WikiLink>,
    );

    const link = screen.getByRole('link', { name: 'the habit loop' });
    expect(link).toHaveAttribute('href', '/wiki/concepts/habit-loop');
    expect(link).not.toHaveAttribute('target');
    expect(link).toHaveClass('text-accent-violet', 'underline');
    await userEvent.setup().click(link);
    expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/habit-loop');
  });

  it('keeps a same-page anchor a plain fragment link', () => {
    render(
      <WikiLink href="#how-it-works" fromPath={PAGE} context={CONTEXT}>
        below
      </WikiLink>,
    );

    const link = screen.getByRole('link', { name: 'below' });
    expect(link).toHaveAttribute('href', '#how-it-works');
    expect(link).not.toHaveAttribute('target');
  });

  it('opens a raw citation on GitHub in a new tab, marked ↗', () => {
    render(
      <WikiLink
        href="../../raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour"
        fromPath={PAGE}
        context={CONTEXT}
      >
        excerpt
      </WikiLink>,
    );

    const link = screen.getByRole('link', { name: 'excerpt (opens in a new tab)' });
    expect(link).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/blob/main/raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour`,
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('excerpt↗ (opens in a new tab)');
  });

  it('opens the open web in a new tab, marked ↗', () => {
    render(
      <WikiLink href="https://jamesclear.com/habit-stacking" fromPath={PAGE} context={CONTEXT}>
        the original
      </WikiLink>,
    );

    const link = screen.getByRole('link', { name: 'the original (opens in a new tab)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('the original↗ (opens in a new tab)');
  });

  it('renders a page not in the snapshot as muted, dotted text — not a link', () => {
    render(
      <WikiLink href="../concepts/not-yet.md" fromPath={PAGE} context={CONTEXT}>
        implementation intentions
      </WikiLink>,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const text = screen.getByText('implementation intentions');
    expect(text).toHaveAttribute('title', 'Not in the wiki snapshot');
    expect(text).toHaveClass('text-muted-foreground', 'decoration-dotted');
  });

  it('renders a GitHub-bound link as broken with no repo', () => {
    render(
      <WikiLink href="../../index.md" fromPath={PAGE} context={{ ...CONTEXT, repo: null }}>
        the index
      </WikiLink>,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('the index')).toHaveAttribute('title', 'Not in the wiki snapshot');
  });
});

describe('WikiImageLink', () => {
  it('never loads the image: it links to the file on GitHub, reading its alt, marked ↗', () => {
    render(
      <WikiImageLink
        src="../../raw/2026/2026-10-01-atomic-habits/assets/loop.png"
        alt="the loop"
        fromPath={PAGE}
        context={CONTEXT}
      />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'the loop (opens in a new tab)' });
    expect(link).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/blob/main/raw/2026/2026-10-01-atomic-habits/assets/loop.png`,
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('the loop↗ (opens in a new tab)');
  });

  it('reads the file name when the alt is empty', () => {
    render(<WikiImageLink src="fig.png" alt="" fromPath={PAGE} context={CONTEXT} />);

    expect(screen.getByRole('link', { name: 'fig.png (opens in a new tab)' })).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/blob/main/wiki/concepts/fig.png`,
    );
  });

  it('is broken text with no repo', () => {
    render(
      <WikiImageLink
        src="fig.png"
        alt="a figure"
        fromPath={PAGE}
        context={{ ...CONTEXT, repo: null }}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('a figure')).toHaveAttribute('title', 'Not in the wiki snapshot');
  });
});

describe('WikiMarkdown', () => {
  interface MarkdownProps {
    children: string;
    remarkPlugins: unknown[];
    components: {
      a: (props: Record<string, unknown> & { children?: React.ReactNode }) => React.ReactNode;
      img: (props: Record<string, unknown>) => React.ReactNode;
    };
  }

  function lastProps(): MarkdownProps {
    const props: unknown = mockMarkdownProps.mock.lastCall?.[0];
    if (props === undefined) throw new Error('react-markdown never rendered');
    return props as MarkdownProps;
  }

  function renderBody(body: string) {
    renderWithProviders(<WikiMarkdown body={body} path={PAGE} />, {
      wiki: {
        pages: [
          makeWikiPage(PAGE),
          makeWikiPage('wiki/concepts/habit-loop.md'),
          makeWikiPage('wiki/entities/café.md'),
          makeWikiPage('wiki/concepts/100%-rule.md'),
        ].map((page) => toWikiIndexRow(page)),
        repo: REPO,
      },
    });
  }

  it('hands the body to react-markdown with GFM, the heading-id and raw-URL plugins', () => {
    renderBody('## Early life\n');

    const props = lastProps();
    expect(props.children).toBe('## Early life\n');
    expect(props.remarkPlugins).toHaveLength(3);
    const [, headingIds] = props.remarkPlugins as [unknown, () => (tree: unknown) => void];
    const heading = { type: 'heading', position: { start: { line: 1, column: 1, offset: 0 } } };
    headingIds()({ type: 'root', children: [heading] });
    expect(heading).toHaveProperty(['data', 'hProperties', 'id'], 'early-life');
  });

  it('renders links and images through the link table, against the snapshot and repo', () => {
    renderBody('body');
    const { components } = lastProps();

    render(
      <>
        {components.a({ href: 'habit-loop.md', children: 'loop' })}
        {components.a({ href: '../concepts/not-yet.md', children: 'missing' })}
        {components.img({ src: 'fig.png', alt: 'figure' })}
      </>,
    );

    expect(screen.getByRole('link', { name: 'loop' })).toHaveAttribute(
      'href',
      '/wiki/concepts/habit-loop',
    );
    expect(screen.getByText('missing')).toHaveAttribute('title', 'Not in the wiki snapshot');
    expect(screen.getByRole('link', { name: 'figure (opens in a new tab)' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('resolves the URL as the page wrote it, not the percent-encoded one the renderer hands over', () => {
    renderBody('body');
    const { components } = lastProps();

    render(
      <>
        {components.a({
          href: '../entities/caf%C3%A9.md',
          'data-href': '../entities/café.md',
          children: 'Café',
        })}
        {components.a({ href: '100%25-rule.md', 'data-href': '100%-rule.md', children: 'rule' })}
      </>,
    );

    expect(screen.getByRole('link', { name: 'Café' })).toHaveAttribute(
      'href',
      '/wiki/entities/caf%C3%A9',
    );
    expect(screen.getByRole('link', { name: 'rule' })).toHaveAttribute(
      'href',
      '/wiki/concepts/100%25-rule',
    );
  });

  it('keeps a GFM footnote back-link’s id, aria-label and data-footnote attributes', () => {
    renderBody('body');
    const { components } = lastProps();

    render(
      <>
        {components.a({
          href: '#user-content-fnref-1',
          'data-href': '#user-content-fnref-1',
          id: 'back-1',
          'aria-label': 'Back to reference 1',
          'data-footnote-backref': '',
          className: 'dropped',
          children: '↩',
        })}
      </>,
    );

    const back = screen.getByRole('link', { name: 'Back to reference 1' });
    expect(back).toHaveAttribute('href', '#user-content-fnref-1');
    expect(back).toHaveAttribute('id', 'back-1');
    expect(back).toHaveAttribute('data-footnote-backref', '');
    expect(back).not.toHaveAttribute('data-href');
    expect(back).not.toHaveClass('dropped');
  });

  it('drops raw HTML rather than showing it as text', () => {
    renderBody('<!-- a note -->');
    expect(mockMarkdownProps.mock.lastCall?.[0]).toHaveProperty('skipHtml', true);
  });
});
