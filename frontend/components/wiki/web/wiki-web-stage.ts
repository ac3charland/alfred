import type { Simulation } from 'd3-force';

import { type Point, WIKI_WEB_FORCES, dotRadius } from '@/lib/wiki/web/forces';
import { type WikiWebEdge, type WikiWebNode, edgeKey } from '@/lib/wiki/web/graph';
import { placeLabels } from '@/lib/wiki/web/labels';
import {
  type WikiSimNode,
  createWebSimulation,
  positionsOf,
  prerollSimulation,
  settleSimulation,
} from '@/lib/wiki/web/simulation';
import { type View, fitView, glideTo, revealNode, toScreen, toWorld } from '@/lib/wiki/web/view';

/** Everything the web is drawn from: its dots and edges, the focus, the stage and the motion. */
export interface WikiWebScene {
  nodes: readonly WikiWebNode[];
  edges: readonly WikiWebEdge[];
  /** The day's concept, pulled to the middle and lit at rest; `null` for none. */
  focusId: string | null;
  /** The stage's size, in CSS pixels. */
  size: { width: number; height: number };
  /** Paint only the web at rest: nothing settles, glides or follows on screen. */
  reduced: boolean;
}

/**
 * How a dot or an edge is lit, written to its `data-state`:
 * - `lit` — the node under the pointer or keyboard, or an edge touching it;
 * - `neighbour` — a node linked to the lit one (or to the focus, at rest);
 * - `dim` — everything else while a node is lit by the pointer or keyboard, bar the focus;
 * - `rest` — everything else (the focus's own look is its `data-focus`).
 */
export type WikiWebLight = 'lit' | 'neighbour' | 'dim' | 'rest';

/**
 * The web's moving half, outside React: the physics, where every dot is, the view, the lighting
 * and which names show. Nodes, names and edges register their elements; every tick writes their
 * transforms and endpoints straight into the DOM, and a hover only flips data attributes, so
 * React renders a node once however much the web moves.
 */
export interface WikiWebStage {
  /** The element that places a node at its dot's centre, by path (`null` as it unmounts). */
  setNode: (id: string, element: HTMLElement | null) => void;
  /** A node's name, measured once and placed (or hidden) on every paint. */
  setName: (id: string, element: HTMLElement | null) => void;
  /** Measure every name afresh — once the web font has loaded, say — and place them again. */
  remeasure: () => void;
  /** An edge's line, by {@link edgeKey} (`null` as it unmounts). */
  setEdge: (key: string, element: SVGLineElement | null) => void;
  /**
   * Draw `scene`. Every change to it starts a new sim, warm from where the dots are; the same
   * scene again (an effect re-run) carries on where it was paused. A new set of nodes or edges
   * or a new stage size hands the view back to the web, which then follows the fit of every dot
   * until the reader zooms or pans.
   */
  show: (scene: WikiWebScene) => void;
  /** Stop the frame loop, keeping every position, until the next `show`. */
  pause: () => void;
  /** The view as it is now. */
  view: () => View;
  /** Zoom or pan to `view`: the reader's, so it holds until the page set or stage size changes. */
  setView: (view: View) => void;
  /** Hand the view back to the fit of every dot, gliding there (or at once, reduced). */
  fit: () => void;
  /**
   * Light node `id`'s neighbourhood from the pointer (`hover`) or the keyboard, or stop (`null`).
   * Whichever reached a node last wins while both are on one; with neither, the focus's
   * neighbourhood is lit.
   */
  light: (id: string | null, from: 'hover' | 'keyboard') => void;
  /**
   * The keyboard has reached node `id`. If the stage clips its dot, the view stops following
   * and moves, at the same scale, by the least that shows it with `fitPadding` to spare.
   */
  reveal: (id: string) => void;
  /**
   * Take hold of node `id` under the pointer at `pointer` (stage coordinates), keeping the
   * pointer's offset from its centre; the view holds while it is held. False when there is no
   * such node to hold.
   */
  grab: (id: string, pointer: Point) => boolean;
  /** Move the held node to follow the pointer, now at `pointer` on the stage. */
  drag: (pointer: Point) => void;
  /** Let the held node go. It isn't pinned: the web settles around it. */
  release: () => void;
  /** Whether the reader has taken the view (and a Fit button should show); told on every change. */
  onTaken: (listener: (taken: boolean) => void) => () => void;
}

const px = (value: number): string => `${String(value)}px`;

/** A scene's nodes and edges, as one string: equal strings, the same web. */
const structureOf = ({ nodes, edges }: WikiWebScene): string =>
  `${nodes.map((node) => node.path).join(',')}>${edges.map((edge) => edgeKey(edge)).join(',')}`;

/** Everything that decides the sim a scene gets. */
const signatureOf = (scene: WikiWebScene): string =>
  [
    structureOf(scene),
    scene.focusId ?? '',
    `${String(scene.size.width)}x${String(scene.size.height)}`,
    String(scene.reduced),
  ].join('#');

/** How far short of each dot an edge stops, in screen pixels, so lines never touch a dot. */
const EDGE_GAP = 2;

/** Each node's neighbours, by path. */
function neighbourhoods(scene: WikiWebScene): Map<string, Set<string>> {
  const around = new Map<string, Set<string>>(scene.nodes.map((node) => [node.path, new Set()]));
  for (const { a, b } of scene.edges) {
    around.get(a)?.add(b);
    around.get(b)?.add(a);
  }
  return around;
}

const NO_NEIGHBOURS: ReadonlySet<string> = new Set();

/**
 * A new, empty stage. The first `show` pre-rolls the physics headless so the web opens nearly
 * settled, then animates the rest one tick per animation frame until it comes to rest — or, for
 * reduced motion, runs it to rest and paints once.
 */
export function createWikiWebStage(): WikiWebStage {
  const nodeElements = new Map<string, HTMLElement>();
  const nameElements = new Map<string, HTMLElement>();
  const edgeElements = new Map<string, SVGLineElement>();
  // Names don't scale with the view, so each is measured once, the first time it's placed.
  const nameWidths = new Map<string, number>();
  // Where every dot is, by path: the only record of it, and the next sim's warm start.
  const positions = new Map<string, Point>();
  const takenListeners = new Set<(taken: boolean) => void>();

  let simulation: Simulation<WikiSimNode, undefined> | undefined;
  let scene: WikiWebScene | undefined;
  let signature = '';
  let around = new Map<string, Set<string>>();
  let radii = new Map<string, number>();
  let view: View = { scale: 1, x: 0, y: 0 };
  // Whether the reader's zoom and pan hold: from their first zoom, pan or keyboard reveal until
  // the page set or stage size changes, or they press Fit.
  let taken = false;
  // Whether the view follows the fit of every dot. Off while a dot is held, so a drag moves the
  // dot, not the view.
  let following = false;
  let frame: number | undefined;
  let held: { id: string; offset: Point } | undefined;
  let hovered: string | null = null;
  let keyboard: string | null = null;
  // Which of the two reached a node last: it wins while both are on one.
  let latest: 'hover' | 'keyboard' = 'hover';

  const setTaken = (next: boolean) => {
    if (taken === next) return;
    taken = next;
    for (const listener of takenListeners) listener(taken);
  };

  /**
   * The node whose neighbourhood is lit: whichever of the pointer and the keyboard reached a node
   * last, else the other, else the focus.
   */
  const litId = (): string | null =>
    (latest === 'keyboard' ? (keyboard ?? hovered) : (hovered ?? keyboard)) ??
    scene?.focusId ??
    null;

  const lightOf = (id: string): WikiWebLight => {
    const lit = litId();
    const active = hovered !== null || keyboard !== null;
    if (active && id === lit) return 'lit';
    if (lit !== null && around.get(lit)?.has(id)) return 'neighbour';
    // The day's concept is never dimmed: it keeps its halo and name whatever else is lit.
    if (id === scene?.focusId) return 'rest';
    return active ? 'dim' : 'rest';
  };

  const edgeLightOf = ({ a, b }: WikiWebEdge): WikiWebLight => {
    const lit = litId();
    if (lit !== null && (a === lit || b === lit)) return 'lit';
    return hovered !== null || keyboard !== null ? 'dim' : 'rest';
  };

  const screenOf = (id: string): Point | undefined => {
    const world = positions.get(id);
    return world ? toScreen(view, world) : undefined;
  };

  const placeNode = (id: string, element: HTMLElement) => {
    const point = screenOf(id);
    if (point) element.style.transform = `translate(${px(point.x)}, ${px(point.y)})`;
  };

  const drawEdge = (edge: WikiWebEdge, element: SVGLineElement) => {
    const start = screenOf(edge.a);
    const end = screenOf(edge.b);
    if (!start || !end) return;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const trimStart = (radii.get(edge.a) ?? 0) + EDGE_GAP;
    const trimEnd = (radii.get(edge.b) ?? 0) + EDGE_GAP;
    // Dots so close their gaps overlap draw no line between them.
    const [from, to] =
      length <= trimStart + trimEnd
        ? [start, start]
        : [
            {
              x: start.x + ((end.x - start.x) * trimStart) / length,
              y: start.y + ((end.y - start.y) * trimStart) / length,
            },
            {
              x: end.x - ((end.x - start.x) * trimEnd) / length,
              y: end.y - ((end.y - start.y) * trimEnd) / length,
            },
          ];
    element.setAttribute('x1', String(from.x));
    element.setAttribute('y1', String(from.y));
    element.setAttribute('x2', String(to.x));
    element.setAttribute('y2', String(to.y));
  };

  const widthOf = (id: string): number => {
    const known = nameWidths.get(id);
    if (known !== undefined) return known;
    const element = nameElements.get(id);
    if (!element) return 0;
    const width = element.getBoundingClientRect().width;
    // A name not yet laid out (no font, not in the document) is measured again next paint.
    if (width > 0) nameWidths.set(id, width);
    return width;
  };

  /** Show and place the names that fit, and hide the rest; rerun on every paint. */
  const drawNames = () => {
    if (!scene) return;
    const lit = litId();
    const placed = placeLabels({
      nodes: scene.nodes.flatMap((node) => {
        const point = screenOf(node.path);
        return point
          ? [
              {
                id: node.path,
                x: point.x,
                y: point.y,
                radius: radii.get(node.path) ?? dotRadius(node.degree),
                width: widthOf(node.path),
                degree: node.degree,
              },
            ]
          : [];
      }),
      focusId: scene.focusId,
      litId: lit,
      neighbours: lit === null ? NO_NEIGHBOURS : (around.get(lit) ?? NO_NEIGHBOURS),
      scale: view.scale,
      stage: scene.size,
    });
    for (const [id, element] of nameElements) {
      const placement = placed.get(id);
      element.dataset['shown'] = String(placement !== undefined);
      if (placement) {
        element.style.transform = `translate(${px(placement.dx)}, ${px(placement.dy)})`;
      }
    }
  };

  /** Write every node's place, every edge and every name from where the dots are now. */
  const draw = () => {
    if (!scene) return;
    for (const [id, element] of nodeElements) placeNode(id, element);
    for (const edge of scene.edges) {
      const element = edgeElements.get(edgeKey(edge));
      if (element) drawEdge(edge, element);
    }
    drawNames();
  };

  /** Write every node's and edge's light, then the names, which follow it. */
  const applyLight = () => {
    if (!scene) return;
    for (const [id, element] of nodeElements) element.dataset['state'] = lightOf(id);
    for (const edge of scene.edges) {
      const element = edgeElements.get(edgeKey(edge));
      if (element) element.dataset['state'] = edgeLightOf(edge);
    }
    drawNames();
  };

  /**
   * Read every dot from the sim and follow with the view: it glides toward the fit of every dot,
   * or reaches it at once (`snap`); then draw.
   */
  const paint = (snap: boolean) => {
    if (!simulation || !scene) return;
    const current = positionsOf(simulation);
    for (const [id, point] of current) positions.set(id, point);
    if (following) {
      const target = fitView([...current.values()], scene.size);
      view = snap ? target : glideTo(view, target, WIKI_WEB_FORCES.glideShare);
    }
    draw();
  };

  const step = () => {
    frame = undefined;
    if (!simulation) return;
    simulation.tick();
    // Where d3's own timer would stop: a held dot keeps the energy up until it's let go.
    const resting = simulation.alpha() < simulation.alphaMin();
    paint(false);
    if (resting && !gliding()) return;
    frame = requestAnimationFrame(step);
  };

  /** Whether the view is still on its way to the fit, after the dots have come to rest. */
  const gliding = (): boolean => {
    if (!following || !scene) return false;
    const target = fitView([...positions.values()], scene.size);
    return (
      Math.abs(target.scale - view.scale) > 1e-3 ||
      Math.abs(target.x - view.x) > 0.5 ||
      Math.abs(target.y - view.y) > 0.5
    );
  };

  const animate = () => {
    frame ??= requestAnimationFrame(step);
  };

  const pause = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };

  const nodeOf = (id: string): WikiSimNode | undefined =>
    simulation?.nodes().find((node) => node.id === id);
  const heldNode = (): WikiSimNode | undefined => (held ? nodeOf(held.id) : undefined);

  const holdAt = (node: WikiSimNode, pointer: Point) => {
    if (!held) return;
    const world = toWorld(view, pointer);
    node.fx = world.x + held.offset.x;
    node.fy = world.y + held.offset.y;
  };

  /** The reader has taken the view: nothing moves it until the web is handed it back. */
  const takeOver = () => {
    setTaken(true);
    following = false;
  };

  const show = (next: WikiWebScene) => {
    pause();
    const nextSignature = signatureOf(next);
    if (simulation && nextSignature === signature) {
      if (!next.reduced && (simulation.alpha() >= simulation.alphaMin() || gliding())) animate();
      return;
    }

    const previous = scene;
    // A change of set or of stage size hands the view back to the web, unless a dot is held,
    // which the view leaves where it is.
    const handedBack =
      previous === undefined ||
      structureOf(previous) !== structureOf(next) ||
      previous.size.width !== next.size.width ||
      previous.size.height !== next.size.height;
    if (held === undefined && handedBack) {
      setTaken(false);
      following = true;
    }

    const pinned = heldNode();
    simulation = createWebSimulation({
      nodes: next.nodes,
      edges: next.edges,
      focusId: next.focusId,
      stage: next.size,
      ...(positions.size > 0 ? { previous: positions } : {}),
    });
    scene = next;
    signature = nextSignature;
    around = neighbourhoods(next);
    radii = new Map(next.nodes.map((node) => [node.path, dotRadius(node.degree)]));
    if (previous?.focusId !== next.focusId) nameWidths.clear();

    // A dot still under the pointer stays there in the new sim.
    const node = heldNode();
    if (node && pinned) {
      node.fx = pinned.fx ?? null;
      node.fy = pinned.fy ?? null;
      if (!next.reduced) simulation.alphaTarget(WIKI_WEB_FORCES.dragAlphaTarget);
    }

    applyLight();
    if (next.reduced) {
      settleSimulation(simulation);
      paint(true);
      return;
    }
    prerollSimulation(simulation);
    // The first sight of the web opens on its fit; after that the view glides there.
    paint(previous === undefined);
    animate();
  };

  return {
    setNode: (id, element) => {
      if (element === null) {
        nodeElements.delete(id);
        return;
      }
      nodeElements.set(id, element);
      element.dataset['state'] = lightOf(id);
      placeNode(id, element);
    },
    setName: (id, element) => {
      nameWidths.delete(id);
      if (element === null) {
        nameElements.delete(id);
        return;
      }
      nameElements.set(id, element);
      drawNames();
    },
    remeasure: () => {
      nameWidths.clear();
      drawNames();
    },
    setEdge: (key, element) => {
      if (element === null) {
        edgeElements.delete(key);
        return;
      }
      edgeElements.set(key, element);
      const edge = scene?.edges.find((each) => edgeKey(each) === key);
      if (edge) {
        element.dataset['state'] = edgeLightOf(edge);
        drawEdge(edge, element);
      }
    },
    show,
    pause,
    view: () => view,
    setView: (next) => {
      view = next;
      takeOver();
      draw();
    },
    fit: () => {
      if (!scene) return;
      setTaken(false);
      following = true;
      if (scene.reduced) {
        view = fitView([...positions.values()], scene.size);
        draw();
        return;
      }
      animate();
    },
    light: (id, from) => {
      if (from === 'hover') hovered = id;
      else keyboard = id;
      if (id !== null) latest = from;
      applyLight();
    },
    reveal: (id) => {
      const world = positions.get(id);
      if (!scene || !world) return;
      const revealed = revealNode(
        view,
        world,
        radii.get(id) ?? 0,
        scene.size,
        WIKI_WEB_FORCES.fitPadding,
      );
      if (revealed === view) return;
      takeOver();
      view = revealed;
      draw();
    },
    grab: (id, pointer) => {
      const node = nodeOf(id);
      if (!simulation || !scene || !node) return false;
      const world = toWorld(view, pointer);
      held = { id, offset: { x: (node.x ?? 0) - world.x, y: (node.y ?? 0) - world.y } };
      following = false;
      holdAt(node, pointer);
      if (!scene.reduced) {
        simulation.alphaTarget(WIKI_WEB_FORCES.dragAlphaTarget);
        animate();
      }
      return true;
    },
    drag: (pointer) => {
      const node = heldNode();
      if (!node) return;
      holdAt(node, pointer);
      // Reduced motion moves only the held dot and its edges; the rest wait for the release.
      if (scene?.reduced) {
        node.x = node.fx ?? node.x;
        node.y = node.fy ?? node.y;
        paint(true);
      }
    },
    release: () => {
      const node = heldNode();
      held = undefined;
      if (!simulation || !node) return;
      // Let go, the view follows the fit again unless the reader has taken it.
      following = !taken;
      if (scene?.reduced) {
        // The rest jump to their new places around it, settled before the one paint.
        simulation.alpha(WIKI_WEB_FORCES.restartAlpha);
        settleSimulation(simulation);
        node.fx = null;
        node.fy = null;
        paint(true);
        return;
      }
      node.fx = null;
      node.fy = null;
      simulation.alphaTarget(0);
      animate();
    },
    onTaken: (listener) => {
      takenListeners.add(listener);
      return () => {
        takenListeners.delete(listener);
      };
    },
  };
}
