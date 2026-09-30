'use client';

import { Maximize } from 'lucide-react';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { ViewLink } from '@/components/tasks/view-link';
import { useElementSize } from '@/lib/hooks/use-element-size';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';
import { WIKI_SECTION_LABELS, wikiPageHref } from '@/lib/wiki/sections';
import { dotRadius } from '@/lib/wiki/web/forces';
import { type WikiWebEdge, type WikiWebNode, edgeKey } from '@/lib/wiki/web/graph';
import { truncateName } from '@/lib/wiki/web/labels';

import { type WikiWebHold, useWikiWebGestures } from './use-wiki-web-gestures';
import { type WikiWebStage, createWikiWebStage } from './wiki-web-stage';
import {
  dotClass,
  edgeClass,
  edgeLayerClass,
  fitButtonClass,
  hintClass,
  legendItemClass,
  legendRowClass,
  legendSwatchClass,
  nameClass,
  nodeClass,
  nodeLayerClass,
  nodeLinkClass,
  stageClass,
  stageFrameClass,
  stageHeldClass,
} from './wiki-web.styles';

export interface WikiWebProperties {
  /** The concepts and entities, in index order — the order the keyboard walks. */
  nodes: readonly WikiWebNode[];
  edges: readonly WikiWebEdge[];
  /** The day's concept: pulled to the middle and lit at rest. `null` for none. */
  focusPath: string | null;
  /** The id of the heading that names the web. */
  labelledBy?: string | undefined;
  /**
   * Force the reduced-motion path (stories, tests). Omitted, the web follows
   * `prefers-reduced-motion`.
   */
  reducedMotion?: boolean | undefined;
  className?: string | undefined;
}

const KIND = { concepts: 'concept', entities: 'entity' } as const;

/** The node the keyboard moves to from `index` on `key`, or `undefined` for a key it ignores. */
function keyTarget(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp': {
      return Math.max(0, index - 1);
    }
    case 'ArrowRight':
    case 'ArrowDown': {
      return Math.min(count - 1, index + 1);
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return count - 1;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The web of the wiki's concepts and entities: a dot per page, sized by its links, an edge per
 * linked pair, and the day's concept pulled to the middle with its neighbours lit violet.
 *
 * d3-force lays it out live (see `wiki-web-stage.ts`), and the view — how the world maps onto
 * the stage — fits every dot as the web settles, until the reader zooms or pans; a Fit button
 * then hands it back. Dots and names keep their screen size at every zoom, so zooming spreads
 * the web out rather than blowing it up. Hovering a node, or reaching it from the keyboard,
 * lights its neighbourhood and names it; from 1:1 up, every node on the stage is named where
 * names don't collide. A click opens the page; the gestures are in `use-wiki-web-gestures.ts`.
 *
 * The web is one tab stop: arrow keys, Home and End walk the nodes in index order.
 */
export function WikiWeb({
  nodes,
  edges,
  focusPath,
  labelledBy,
  reducedMotion,
  className,
}: WikiWebProperties) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefersReducedMotion;
  const coarsePointer = useMediaQuery('(pointer: coarse)');

  const stageRef = React.useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const [stage] = React.useState(createWikiWebStage);
  const [hold, setHold] = React.useState<WikiWebHold>(null);
  const [taken, setTaken] = React.useState(false);
  const [keyboardId, setKeyboardId] = React.useState<string | null>(null);
  const hintId = React.useId();

  React.useEffect(() => stage.onTaken(setTaken), [stage]);

  // The sim needs a stage to fit; it starts once the stage has been measured.
  React.useLayoutEffect(() => {
    if (!size) return;
    stage.show({ nodes, edges, focusId: focusPath, size, reduced });
    return stage.pause;
  }, [stage, nodes, edges, focusPath, size, reduced]);

  // Names are measured to cull overlaps; the web font arriving changes every width.
  React.useEffect(() => {
    let live = true;
    // Not every document has a font set to wait on (jsdom has none).
    const { fonts } = document as Partial<Pick<Document, 'fonts'>>;
    void fonts?.ready.then(() => {
      if (live) stage.remeasure();
    });
    return () => {
      live = false;
    };
  }, [stage]);

  useWikiWebGestures(stageRef, stage, setHold);

  // A node the keyboard reaches is lit like a hover, and brought into view if the stage clips it.
  const keyboardFocus = React.useCallback(
    (id: string | null) => {
      if (id !== null) setKeyboardId(id);
      stage.light(id, 'keyboard');
      if (id !== null) stage.reveal(id);
    },
    [stage],
  );

  // The one tab stop: where the keyboard last was, else the focus, else the first node.
  const tabStop =
    keyboardId !== null && nodes.some((node) => node.path === keyboardId)
      ? keyboardId
      : (focusPath ?? nodes[0]?.path ?? null);

  // The keys that walk the web, held once so every node keeps one handler for good.
  const latestNodes = React.useRef(nodes);
  React.useEffect(() => {
    latestNodes.current = nodes;
  });
  const walk = React.useCallback((from: string, event: React.KeyboardEvent) => {
    const walked = latestNodes.current;
    const index = walked.findIndex((node) => node.path === from);
    const target = index === -1 ? undefined : keyTarget(event.key, index, walked.length);
    if (target === undefined) return;
    event.preventDefault();
    const path = walked[target]?.path;
    const link = [...(stageRef.current?.querySelectorAll<HTMLElement>('[data-wiki-node]') ?? [])]
      .find((element) => element.dataset['wikiNode'] === path)
      ?.querySelector('a');
    // The view reveals the node itself; the page shouldn't scroll to it too.
    link?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className={stageFrameClass}>
        <div
          ref={stageRef}
          role="group"
          aria-labelledby={labelledBy}
          aria-describedby={hintId}
          className={cn(stageClass, hold !== null && stageHeldClass)}
        >
          <svg aria-hidden="true" className={edgeLayerClass}>
            {edges.map((edge) => (
              <WikiWebEdgeLine key={edgeKey(edge)} edge={edge} stage={stage} />
            ))}
          </svg>
          <div className={cn(nodeLayerClass, size === undefined && 'invisible')}>
            {nodes.map((node) => (
              <WikiWebDot
                key={node.path}
                node={node}
                focused={node.path === focusPath}
                tabbable={node.path === tabStop}
                stage={stage}
                onKeyboardFocus={keyboardFocus}
                onWalk={walk}
              />
            ))}
          </div>
        </div>
        {taken ? (
          <IconButton aria-label="Fit the web" className={fitButtonClass} onClick={stage.fit}>
            <Maximize size={14} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <p id={hintId} className="sr-only">
        Use the arrow keys to move between pages.
      </p>
      <div aria-hidden="true" className={legendRowClass}>
        <span className="flex items-center gap-3">
          <span className={legendItemClass}>
            <span className={legendSwatchClass.concept} />
            Concept
          </span>
          <span className={legendItemClass}>
            <span className={legendSwatchClass.entity} />
            Entity
          </span>
        </span>
        <span className={hintClass}>
          {coarsePointer ? 'Pinch to zoom' : 'Pinch or ⌘-scroll to zoom · drag to pan'}
        </span>
      </div>
    </div>
  );
}

/** One edge's line, handed to the stage, which draws its endpoints every tick. */
const WikiWebEdgeLine = React.memo(function WikiWebEdgeLine({
  edge,
  stage,
}: {
  edge: WikiWebEdge;
  stage: WikiWebStage;
}) {
  const key = edgeKey(edge);
  return (
    <line
      ref={(element) => {
        stage.setEdge(key, element);
      }}
      className={edgeClass}
    />
  );
});

interface WikiWebDotProperties {
  node: WikiWebNode;
  /** The day's concept. */
  focused: boolean;
  /** The web's one tab stop. */
  tabbable: boolean;
  stage: WikiWebStage;
  /** Keyboard focus came onto this node (its path), or left it (`null`). */
  onKeyboardFocus: (id: string | null) => void;
  /** A key went down on this node's link: an arrow, Home or End moves to another node. */
  onWalk: (from: string, event: React.KeyboardEvent) => void;
}

/**
 * A node on the web: an element the stage places at the dot's centre, holding the page's link —
 * the dot, its name and, for a screen reader, the full title and kind. The stage moves it by
 * writing its transform and lights it by writing its `data-state`, so this renders only when
 * what it shows changes.
 */
const WikiWebDot = React.memo(function WikiWebDot({
  node,
  focused,
  tabbable,
  stage,
  onKeyboardFocus,
  onWalk,
}: WikiWebDotProperties) {
  const kind = KIND[node.section];
  const diameter = 2 * dotRadius(node.degree);
  return (
    <div
      ref={(element) => {
        stage.setNode(node.path, element);
      }}
      data-wiki-node={node.path}
      data-kind={kind}
      data-focus={focused ? 'true' : undefined}
      className={nodeClass}
    >
      <ViewLink
        href={wikiPageHref(node.path)}
        tabIndex={tabbable ? 0 : -1}
        draggable={false}
        className={nodeLinkClass}
        onPointerEnter={() => {
          stage.light(node.path, 'hover');
        }}
        onPointerLeave={() => {
          stage.light(null, 'hover');
        }}
        // Only focus the keyboard gave: a click focuses a link too, and that isn't a walk.
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) onKeyboardFocus(node.path);
        }}
        onBlur={() => {
          onKeyboardFocus(null);
        }}
        onKeyDown={(event) => {
          onWalk(node.path, event);
        }}
      >
        <span
          aria-hidden="true"
          className={dotClass[kind]}
          style={{ width: diameter, height: diameter }}
        />
        {/* Keyed by what sets its width, so a new title or the focus's font is measured afresh. */}
        <span
          key={`${node.title}|${String(focused)}`}
          aria-hidden="true"
          ref={(element) => {
            stage.setName(node.path, element);
          }}
          data-shown="false"
          className={nameClass}
        >
          {truncateName(node.title)}
        </span>
        <span className="sr-only">{`${node.title}, ${WIKI_SECTION_LABELS[node.section].singular.toLowerCase()}`}</span>
      </ViewLink>
    </div>
  );
});
