'use client';

import * as React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ViewLink } from '@/components/tasks/view-link';
import { useWikiConfig, useWikiPages } from '@/lib/stores/wiki-store';
import { remarkHeadingIds } from '@/lib/wiki/heading-ids';
import { type WikiLinkContext, resolveWikiLink } from '@/lib/wiki/links';

import { RAW_URL_ATTRIBUTE, remarkRawUrls } from './remark-raw-urls';
import {
  brokenLinkClass,
  outboundMarkClass,
  wikiLinkClass,
  wikiProseClass,
} from './wiki-markdown.styles';

/** The title a link with nowhere to go carries, so a hover says why it isn't one. */
export const BROKEN_LINK_TITLE = 'Not in the wiki snapshot';

/** The attributes a live link keeps from the markdown: GFM footnotes ride on these. */
export type WikiLinkPassthrough = Record<string, unknown>;

interface WikiLinkProperties {
  href: string | undefined;
  /** The page the link is written on, which relative hrefs resolve against. */
  fromPath: string;
  context: WikiLinkContext;
  /**
   * `id`, `title`, `aria-*` and `data-footnote-*` from the rendered element, spread onto the
   * anchor — a GFM footnote reference and its back-link find each other through them.
   */
  passthrough?: WikiLinkPassthrough;
  children?: React.ReactNode;
}

/**
 * The ↗ an outbound link wears. The glyph is hidden from assistive tech; what it means is said
 * in words instead, so the link's name warns that it opens a new tab.
 */
export function OutboundMark() {
  return (
    <>
      <span aria-hidden="true" className={outboundMarkClass}>
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  );
}

/** Whether an element attribute is one a live link keeps (see {@link WikiLinkProperties}). */
function isPassthrough(name: string): boolean {
  return (
    name === 'id' ||
    name === 'title' ||
    name.startsWith('aria-') ||
    name.startsWith('data-footnote-')
  );
}

/** The passthrough attributes of an override's props. */
export function linkPassthrough(props: Record<string, unknown>): WikiLinkPassthrough {
  return Object.fromEntries(Object.entries(props).filter(([name]) => isPassthrough(name)));
}

/** The URL as the page wrote it — the raw-URL plugin's copy, else the (encoded) hast one. */
function rawUrl(props: Record<string, unknown>, fallback: string | undefined): string | undefined {
  const raw = props[RAW_URL_ATTRIBUTE];
  return typeof raw === 'string' ? raw : fallback;
}

/**
 * One href from a page body, rendered per the wiki's link table: an in-app page link switches
 * views client-side, a same-page anchor stays a plain fragment link, GitHub and the open web open
 * in a new tab with ↗, and a link with nowhere to go is muted, dotted text rather than a link.
 */
export function WikiLink({
  href,
  fromPath,
  context,
  passthrough = {},
  children,
}: WikiLinkProperties) {
  const target = resolveWikiLink(href ?? '', fromPath, context);
  switch (target.kind) {
    case 'page': {
      return (
        <ViewLink {...passthrough} href={target.href} className={wikiLinkClass}>
          {children}
        </ViewLink>
      );
    }
    case 'anchor': {
      return (
        <a {...passthrough} href={target.href} className={wikiLinkClass}>
          {children}
        </a>
      );
    }
    case 'github':
    case 'external': {
      return (
        <a
          {...passthrough}
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          className={wikiLinkClass}
        >
          {children}
          <OutboundMark />
        </a>
      );
    }
    case 'broken': {
      return (
        <span title={BROKEN_LINK_TITLE} className={brokenLinkClass}>
          {children}
        </span>
      );
    }
  }
}

interface WikiImageLinkProperties {
  src: string | undefined;
  alt: string | undefined;
  fromPath: string;
  context: WikiLinkContext;
}

/**
 * An image in a page body, never loaded: the repo is private, so the browser could not fetch it,
 * and a broken image is worse than a link. It renders as a link to the file reading its alt text
 * (or the file name, when the alt is empty), marked ↗ — or as broken text with nowhere to link.
 */
export function WikiImageLink({ src, alt, fromPath, context }: WikiImageLinkProperties) {
  const source = src ?? '';
  const text = alt?.trim() ?? '';
  const fileName = source.split('/').at(-1) ?? '';
  const label = text === '' ? (fileName === '' ? 'image' : fileName) : text;
  // An image is always a file, never a page to open in-app, so it resolves against an empty
  // snapshot: an image path in the page shape (`wiki/<section>/<name>.md`) renders broken, and any
  // other in-repo path goes to GitHub.
  const target = resolveWikiLink(source, fromPath, { index: new Set(), repo: context.repo });
  if (target.kind === 'github' || target.kind === 'external') {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className={wikiLinkClass}>
        {label}
        <OutboundMark />
      </a>
    );
  }
  return (
    <span title={BROKEN_LINK_TITLE} className={brokenLinkClass}>
      {label}
    </span>
  );
}

interface WikiMarkdownProperties {
  /** The page's raw markdown body. */
  body: string;
  /** The page's own path, which its relative links resolve against. */
  path: string;
}

/**
 * A page body: react-markdown with GFM, heading ids computed the wiki's way from the raw source
 * (so every `#anchor` the wiki's lint checked lands), and the link table applied to every link
 * and image — resolved from the URL as written, not the encoded one the renderer hands over.
 */
export function WikiMarkdown({ body, path }: WikiMarkdownProperties) {
  const pages = useWikiPages();
  const { repo } = useWikiConfig();

  const context = React.useMemo<WikiLinkContext>(
    () => ({ index: new Set(pages.map((page) => page.path)), repo }),
    [pages, repo],
  );

  const remarkPlugins = React.useMemo(
    () => [remarkGfm, remarkHeadingIds(body), remarkRawUrls],
    [body],
  );

  const components = React.useMemo<Components>(
    () => ({
      a: ({ node: _node, href, children, ...props }) => (
        <WikiLink
          href={rawUrl(props, href)}
          fromPath={path}
          context={context}
          passthrough={linkPassthrough(props)}
        >
          {children}
        </WikiLink>
      ),
      img: ({ node: _node, src, alt, ...props }) => (
        <WikiImageLink
          src={rawUrl(props, typeof src === 'string' ? src : undefined)}
          alt={alt}
          fromPath={path}
          context={context}
        />
      ),
    }),
    [path, context],
  );

  return (
    <div data-testid="wiki-body" className={wikiProseClass}>
      {/* skipHtml: a page's raw HTML (an HTML comment, say) is dropped, never shown as text. */}
      <Markdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {body}
      </Markdown>
    </div>
  );
}
