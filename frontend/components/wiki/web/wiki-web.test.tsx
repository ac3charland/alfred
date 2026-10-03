import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { resetWikiFixtureClock, toWikiIndexRow, wikiWebFixtureSet } from '@/lib/wiki/fixtures';
import { dotRadius } from '@/lib/wiki/web/forces';
import { type WikiWebEdge, type WikiWebNode, buildWikiWeb } from '@/lib/wiki/web/graph';

import { WikiWeb, type WikiWebProperties } from './wiki-web';

const STAGE = { width: 736, height: 440 };

/** A ResizeObserver that reports the stage's size as soon as it is asked to watch. */
class StageResizeObserver {
  private target: Element | undefined;

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.target = target;
    const entry = { target: this.target, contentRect: STAGE } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve(): void {}

  disconnect(): void {}
}

/** Animation frames the web has asked for and not yet had, in the order it asked. */
const frames = new Map<number, FrameRequestCallback>();

/** Run animation frames until the web stops asking for them (or 2000 have run). */
function runToRest(): void {
  act(() => {
    for (let run = 0; run < 2000; run += 1) {
      const [next] = frames;
      if (!next) return;
      frames.delete(next[0]);
      next[1](performance.now());
    }
  });
}

const { ResizeObserver: realResizeObserver } = globalThis;
let pushState: jest.SpyInstance;

beforeEach(() => {
  globalThis.ResizeObserver = StageResizeObserver;
  frames.clear();
  let requested = 0;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    requested += 1;
    frames.set(requested, callback);
    return requested;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((handle) => {
    frames.delete(handle);
  });
  pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver;
});

resetWikiFixtureClock();
const SAMPLE = buildWikiWeb(wikiWebFixtureSet().pages.map((page) => toWikiIndexRow(page)));
const FOCUS = 'wiki/concepts/desirable-difficulty.md';
const MEDINA = 'wiki/entities/john-medina.md';

/** The web under a heading that names it, at rest in one paint unless told otherwise. */
function renderWeb(properties: Partial<WikiWebProperties> = {}) {
  const all: WikiWebProperties = {
    nodes: SAMPLE.nodes,
    edges: SAMPLE.edges,
    focusPath: FOCUS,
    labelledBy: 'web-heading',
    reducedMotion: true,
    ...properties,
  };
  return render(
    <>
      <h3 id="web-heading">Concepts & entities</h3>
      <WikiWeb {...all} />
    </>,
  );
}

const stage = () => screen.getByRole('group', { name: 'Concepts & entities' });

/** The element the stage places for `path`. */
function nodeElement(path: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-wiki-node="${CSS.escape(path)}"]`);
  if (!element) throw new Error(`no node ${path}`);
  return element;
}

const linkOf = (path: string): HTMLElement => within(nodeElement(path)).getByRole('link');
const stateOf = (path: string): string | undefined => nodeElement(path).dataset['state'];
const nameShown = (path: string): boolean =>
  nodeElement(path).querySelector<HTMLElement>('[data-shown]')?.dataset['shown'] === 'true';

/** Where the stage has put `path`'s dot, read off its translate. */
function placeOf(path: string): { x: number; y: number } {
  const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(nodeElement(path).style.transform);
  if (!match) throw new Error(`${path} was never placed`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** The neighbours of `path` in `edges`. */
function neighboursOf(path: string, edges: readonly WikiWebEdge[] = SAMPLE.edges): string[] {
  return edges.flatMap(({ a, b }) => (a === path ? [b] : b === path ? [a] : []));
}

/** Press on `target`, move `by` pixels, and let go. */
async function pressAndMove(
  user: ReturnType<typeof userEvent.setup>,
  target: Element,
  by: { x: number; y: number },
) {
  const start = { clientX: 300, clientY: 200 };
  await user.pointer([
    { keys: '[MouseLeft>]', target, coords: start },
    { coords: { clientX: start.clientX + by.x / 2, clientY: start.clientY + by.y / 2 } },
    { coords: { clientX: start.clientX + by.x, clientY: start.clientY + by.y } },
    { keys: '[/MouseLeft]' },
  ]);
}

describe('WikiWeb — what it draws', () => {
  it('draws one link per concept and entity, named by its full title and kind', () => {
    renderWeb();

    const links = within(stage()).getAllByRole('link');
    expect(links).toHaveLength(52);
    expect(within(stage()).getByRole('link', { name: 'John Medina, entity' })).toHaveAttribute(
      'href',
      '/wiki/entities/john-medina',
    );
    expect(
      within(stage()).getByRole('link', { name: 'Desirable difficulty, concept' }),
    ).toHaveAttribute('href', '/wiki/concepts/desirable-difficulty');
  });

  it('draws one line per edge', () => {
    renderWeb();

    expect(stage().querySelectorAll('line')).toHaveLength(SAMPLE.edges.length);
  });

  it('marks each node as a concept or an entity, sized by its links', () => {
    renderWeb();

    expect(nodeElement(FOCUS).dataset['kind']).toBe('concept');
    expect(nodeElement(MEDINA).dataset['kind']).toBe('entity');
    const medina = SAMPLE.nodes.find((node) => node.path === MEDINA);
    const dot = linkOf(MEDINA).querySelector<HTMLElement>('span');
    expect(dot?.style.width).toBe(`${String(2 * dotRadius(medina?.degree ?? 0))}px`);
  });

  it('puts every dot inside the stage on the first paint', () => {
    renderWeb();

    for (const node of SAMPLE.nodes) {
      const { x, y } = placeOf(node.path);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(STAGE.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(STAGE.height);
    }
  });

  it('lays the same pages out the same way on every run', () => {
    const { unmount } = renderWeb();
    const first = SAMPLE.nodes.map((node) => placeOf(node.path));
    unmount();

    renderWeb();

    expect(SAMPLE.nodes.map((node) => placeOf(node.path))).toEqual(first);
  });

  it('draws a lone node at the middle of the stage', () => {
    const lone: WikiWebNode[] = [
      { path: FOCUS, title: 'Desirable difficulty', section: 'concepts', degree: 0 },
    ];
    renderWeb({ nodes: lone, edges: [] });

    expect(placeOf(FOCUS)).toEqual({ x: STAGE.width / 2, y: STAGE.height / 2 });
  });
});

/** Every node's place, by path. */
const placesOf = (nodes: readonly WikiWebNode[]) =>
  new Map(nodes.map((node) => [node.path, placeOf(node.path)]));

/** How far, in all, the dots in `before` moved to reach `after`. */
function totalShift(
  before: ReadonlyMap<string, { x: number; y: number }>,
  after: ReadonlyMap<string, { x: number; y: number }>,
): number {
  let total = 0;
  for (const [path, from] of before) {
    const to = after.get(path);
    if (to) total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/** A pointer event as a finger sends it; jsdom has no PointerEvent, so a mouse event carries it. */
const finger = (
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  pointerId: number,
  x: number,
  y: number,
) =>
  Object.assign(
    new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
    { pointerId, pointerType: 'touch' },
  );

/** The heading {@link renderWeb} names the web by, for a rerender to keep. */
const heading = <h3 id="web-heading">Concepts & entities</h3>;

/** {@link renderWeb}'s properties, changed by `properties`, for a rerender. */
const props = (properties: Partial<WikiWebProperties>): WikiWebProperties => ({
  nodes: SAMPLE.nodes,
  edges: SAMPLE.edges,
  focusPath: FOCUS,
  labelledBy: 'web-heading',
  reducedMotion: true,
  ...properties,
});

describe('WikiWeb — a refreshed index or a new day', () => {
  it("re-lights the web around a new day's concept", () => {
    const { rerender } = renderWeb();
    const next = 'wiki/concepts/second-brain.md';

    rerender(
      <>
        {heading}
        <WikiWeb {...props({ focusPath: next })} />
      </>,
    );

    expect(nodeElement(next).dataset['focus']).toBe('true');
    expect(nodeElement(FOCUS).dataset['focus']).toBeUndefined();
    for (const path of neighboursOf(next)) expect(stateOf(path)).toBe('neighbour');
    expect(stateOf('wiki/entities/robert-bjork.md')).toBe('rest');
  });

  it('starts warm from where the dots are when a page joins, rather than laying out afresh', () => {
    const joining = 'wiki/concepts/bids-for-connection.md';
    const without = {
      nodes: SAMPLE.nodes.filter((node) => node.path !== joining),
      edges: SAMPLE.edges.filter(({ a, b }) => a !== joining && b !== joining),
    };
    const cold = renderWeb();
    const afresh = placesOf(without.nodes);
    cold.unmount();

    const { rerender } = renderWeb(without);
    const before = placesOf(without.nodes);
    rerender(
      <>
        {heading}
        <WikiWeb {...props({})} />
      </>,
    );
    const warm = placesOf(without.nodes);

    // A cold layout of the new set scatters the old dots; the warm start leaves them near home.
    expect(totalShift(before, warm)).toBeLessThan(totalShift(before, afresh) / 3);
  });
});

describe('WikiWeb — touch', () => {
  it('zooms with a two-finger pinch, and offers Fit', () => {
    renderWeb();

    fireEvent(stage(), finger('pointerdown', 1, 300, 200));
    fireEvent(stage(), finger('pointerdown', 2, 340, 200));
    fireEvent(stage(), finger('pointermove', 2, 420, 200));
    fireEvent(stage(), finger('pointerup', 2, 420, 200));
    fireEvent(stage(), finger('pointerup', 1, 300, 200));

    expect(screen.getByRole('button', { name: 'Fit the web' })).toBeInTheDocument();
  });

  it('leaves one finger to the page: it neither drags a node nor pans', () => {
    renderWeb();
    const before = placesOf(SAMPLE.nodes);

    fireEvent(linkOf(MEDINA), finger('pointerdown', 1, 300, 200));
    fireEvent(linkOf(MEDINA), finger('pointermove', 1, 380, 260));
    fireEvent(linkOf(MEDINA), finger('pointerup', 1, 380, 260));

    expect(placesOf(SAMPLE.nodes)).toEqual(before);
    expect(screen.queryByRole('button', { name: 'Fit the web' })).not.toBeInTheDocument();
  });
});

describe('WikiWeb — the focus at rest', () => {
  it("marks the day's concept, and lights its neighbours and edges", () => {
    renderWeb();

    expect(nodeElement(FOCUS).dataset['focus']).toBe('true');
    expect(nodeElement(FOCUS).dataset['featured']).toBe('true');
    const neighbours = neighboursOf(FOCUS);
    expect(neighbours).toHaveLength(6);
    for (const path of neighbours) expect(stateOf(path)).toBe('neighbour');
    expect(stateOf(MEDINA)).toBe('rest');

    const lit = [...stage().querySelectorAll<SVGLineElement>('line')].filter(
      (line) => line.dataset['state'] === 'lit',
    );
    expect(lit).toHaveLength(6);
  });

  it('names the focus and its neighbours, and nobody else, below 1:1', () => {
    renderWeb();

    expect(nameShown(FOCUS)).toBe(true);
    for (const path of neighboursOf(FOCUS)) expect(nameShown(path)).toBe(true);
    const others = SAMPLE.nodes.filter(
      (node) => node.path !== FOCUS && !neighboursOf(FOCUS).includes(node.path),
    );
    for (const node of others) expect(nameShown(node.path)).toBe(false);
  });

  it('lights nothing and names nobody with no focus', () => {
    renderWeb({ focusPath: null });

    for (const node of SAMPLE.nodes) {
      expect(stateOf(node.path)).toBe('rest');
      expect(nameShown(node.path)).toBe(false);
    }
  });
});

describe('WikiWeb — hover', () => {
  it("lights a hovered node's neighbourhood and dims the rest, then restores the rest", async () => {
    const user = userEvent.setup();
    renderWeb();

    await user.hover(linkOf(MEDINA));

    expect(stateOf(MEDINA)).toBe('lit');
    expect(nameShown(MEDINA)).toBe(true);
    for (const path of neighboursOf(MEDINA)) {
      expect(stateOf(path)).toBe('neighbour');
      expect(nameShown(path)).toBe(true);
    }
    expect(stateOf('wiki/concepts/zettelkasten.md')).toBe('dim');
    expect(nameShown('wiki/entities/robert-bjork.md')).toBe(false);

    await user.unhover(linkOf(MEDINA));

    expect(stateOf(MEDINA)).toBe('rest');
    expect(stateOf('wiki/concepts/zettelkasten.md')).toBe('rest');
    expect(nameShown('wiki/entities/robert-bjork.md')).toBe(true);
  });

  it("hides the day's concept while another node is hovered, and brings it back after", async () => {
    const user = userEvent.setup();
    renderWeb();
    expect(neighboursOf(MEDINA)).not.toContain(FOCUS);

    await user.hover(linkOf(MEDINA));

    expect(nodeElement(FOCUS).dataset['featured']).toBeUndefined();
    expect(stateOf(FOCUS)).toBe('dim');
    expect(nameShown(FOCUS)).toBe(false);

    await user.unhover(linkOf(MEDINA));

    expect(nodeElement(FOCUS).dataset['featured']).toBe('true');
    expect(stateOf(FOCUS)).toBe('rest');
    expect(nameShown(FOCUS)).toBe(true);
  });

  it("shows the day's concept as an ordinary neighbour of a hovered node it links to", async () => {
    const user = userEvent.setup();
    renderWeb();
    const [neighbour = ''] = neighboursOf(FOCUS);

    await user.hover(linkOf(neighbour));

    expect(nodeElement(FOCUS).dataset['featured']).toBeUndefined();
    expect(stateOf(FOCUS)).toBe('neighbour');
    expect(nameShown(FOCUS)).toBe(true);
  });

  it("measures the day's concept's name afresh when it stops being featured", async () => {
    // jsdom lays nothing out, so names are given a width; one measured is kept until a change
    // to its font asks for it again. The featured name's larger, bold font is such a change.
    const measure = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ width: 100 }) as DOMRect);
    const user = userEvent.setup();
    renderWeb();
    const name = nodeElement(FOCUS).querySelector('[data-shown]');
    expect(measure.mock.contexts).toContain(name);
    const before = measure.mock.contexts.length;

    await user.hover(linkOf(neighboursOf(FOCUS)[0] ?? ''));

    expect(measure.mock.contexts.slice(before)).toContain(name);
  });

  it("keeps the day's concept marked while it is the node hovered", async () => {
    const user = userEvent.setup();
    renderWeb();

    await user.hover(linkOf(FOCUS));

    expect(nodeElement(FOCUS).dataset['featured']).toBe('true');
    expect(stateOf(FOCUS)).toBe('lit');
    expect(nameShown(FOCUS)).toBe(true);
  });
});

describe('WikiWeb — zoom, pan and fit', () => {
  it('leaves a plain wheel to scroll the page', () => {
    renderWeb();
    const before = placeOf(MEDINA);

    const notCancelled = fireEvent.wheel(stage(), { deltaY: -300, clientX: 200, clientY: 150 });

    expect(notCancelled).toBe(true);
    expect(placeOf(MEDINA)).toEqual(before);
    expect(screen.queryByRole('button', { name: 'Fit the web' })).not.toBeInTheDocument();
  });

  it.each([
    ['a trackpad pinch', { ctrlKey: true }],
    ['⌘ + wheel', { metaKey: true }],
  ])('zooms with %s, offers Fit, and Fit hands the view back', async (_label, modifier) => {
    const user = userEvent.setup();
    renderWeb();
    const before = SAMPLE.nodes.map((node) => placeOf(node.path));

    const notCancelled = fireEvent.wheel(stage(), {
      deltaY: -300,
      clientX: 368,
      clientY: 220,
      ...modifier,
    });

    expect(notCancelled).toBe(false);
    expect(placeOf(MEDINA)).not.toEqual(before[SAMPLE.nodes.findIndex((n) => n.path === MEDINA)]);
    await user.click(screen.getByRole('button', { name: 'Fit the web' }));

    expect(screen.queryByRole('button', { name: 'Fit the web' })).not.toBeInTheDocument();
    expect(SAMPLE.nodes.map((node) => placeOf(node.path))).toEqual(before);
  });

  it('names every node on the stage once zoomed past 1:1, keeping the dots their size', () => {
    renderWeb();
    const dot = linkOf(MEDINA).querySelector<HTMLElement>('span');
    const width = dot?.style.width;

    for (let turn = 0; turn < 3; turn += 1) {
      fireEvent.wheel(stage(), { deltaY: -300, clientX: 368, clientY: 220, ctrlKey: true });
    }

    const onStage = SAMPLE.nodes.filter((node) => {
      const { x, y } = placeOf(node.path);
      return x >= 0 && x <= STAGE.width && y >= 0 && y <= STAGE.height;
    });
    expect(onStage.length).toBeGreaterThan(0);
    for (const node of onStage) expect(nameShown(node.path)).toBe(true);
    expect(dot?.style.width).toBe(width);
  });

  it('pans with a drag on empty stage', async () => {
    const user = userEvent.setup();
    renderWeb();
    const before = placeOf(MEDINA);

    await pressAndMove(user, stage(), { x: 40, y: 30 });

    const after = placeOf(MEDINA);
    expect(after.x).toBeCloseTo(before.x + 40);
    expect(after.y).toBeCloseTo(before.y + 30);
    expect(screen.getByRole('button', { name: 'Fit the web' })).toBeInTheDocument();
  });
});

describe('WikiWeb — clicking and dragging nodes', () => {
  it('opens a page in-app with a click', async () => {
    const user = userEvent.setup();
    renderWeb();

    await user.click(linkOf(MEDINA));

    expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/entities/john-medina');
  });

  it('drags a node without opening it, and its neighbours follow', async () => {
    const user = userEvent.setup();
    renderWeb();
    const neighbour = neighboursOf(MEDINA)[0] ?? '';
    const before = { medina: placeOf(MEDINA), neighbour: placeOf(neighbour) };

    await pressAndMove(user, linkOf(MEDINA), { x: 80, y: 40 });

    expect(pushState).not.toHaveBeenCalled();
    expect(placeOf(MEDINA)).not.toEqual(before.medina);
    expect(placeOf(neighbour)).not.toEqual(before.neighbour);
  });

  it('animates the web to rest when motion is allowed', () => {
    renderWeb({ reducedMotion: false });
    const opening = placeOf(MEDINA);

    runToRest();

    expect(placeOf(MEDINA)).not.toEqual(opening);
    expect(frames.size).toBe(0);
  });
});

describe('WikiWeb — the keyboard', () => {
  it('is one tab stop, landing on the focus', async () => {
    const user = userEvent.setup();
    renderWeb();

    const tabbable = within(stage())
      .getAllByRole('link')
      .filter((link) => link.tabIndex === 0);
    expect(tabbable).toEqual([linkOf(FOCUS)]);

    await user.tab();
    expect(linkOf(FOCUS)).toHaveFocus();
  });

  it('lands on the first node with no focus', async () => {
    const user = userEvent.setup();
    renderWeb({ focusPath: null });

    await user.tab();

    expect(linkOf(SAMPLE.nodes[0]?.path ?? '')).toHaveFocus();
  });

  it('walks the nodes in index order with the arrows, Home and End, lighting each', async () => {
    const user = userEvent.setup();
    renderWeb();
    const order = SAMPLE.nodes.map((node) => node.path);
    const at = order.indexOf(FOCUS);
    await user.tab();

    await user.keyboard('{ArrowRight}');
    expect(linkOf(order[at + 1] ?? '')).toHaveFocus();
    expect(stateOf(order[at + 1] ?? '')).toBe('lit');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(linkOf(order[at - 1] ?? '')).toHaveFocus();

    await user.keyboard('{End}');
    expect(linkOf(order.at(-1) ?? '')).toHaveFocus();

    await user.keyboard('{Home}');
    expect(linkOf(order[0] ?? '')).toHaveFocus();

    // The tab stop follows the keyboard, so Tab back in returns to where it left.
    expect(linkOf(order[0] ?? '')).toHaveAttribute('tabindex', '0');
    expect(linkOf(FOCUS)).toHaveAttribute('tabindex', '-1');
  });

  it("hides the day's concept while the keyboard is on another node", async () => {
    const user = userEvent.setup();
    renderWeb();
    await user.tab();
    expect(nodeElement(FOCUS).dataset['featured']).toBe('true');

    await user.keyboard('{End}');

    expect(neighboursOf(SAMPLE.nodes.at(-1)?.path ?? '')).not.toContain(FOCUS);
    expect(nodeElement(FOCUS).dataset['featured']).toBeUndefined();
    expect(stateOf(FOCUS)).toBe('dim');
    expect(nameShown(FOCUS)).toBe(false);

    await user.tab();

    expect(nodeElement(FOCUS).dataset['featured']).toBe('true');
    expect(nameShown(FOCUS)).toBe(true);
  });

  it('lights whichever of the pointer and the keyboard moved last', async () => {
    const user = userEvent.setup();
    renderWeb();
    const order = SAMPLE.nodes.map((node) => node.path);
    const next = order[order.indexOf(FOCUS) + 1] ?? '';
    await user.hover(linkOf(MEDINA));
    await user.tab();

    await user.keyboard('{ArrowRight}');
    expect(stateOf(next)).toBe('lit');
    expect(stateOf(MEDINA)).not.toBe('lit');

    await user.hover(linkOf('wiki/entities/peter-attia.md'));
    expect(stateOf('wiki/entities/peter-attia.md')).toBe('lit');
    expect(stateOf(next)).not.toBe('lit');
  });

  it('opens the focused page with Enter', async () => {
    const user = userEvent.setup();
    renderWeb();
    await user.tab();

    await user.keyboard('{ArrowRight}{Enter}');

    const next = SAMPLE.nodes[SAMPLE.nodes.findIndex((node) => node.path === FOCUS) + 1];
    expect(pushState).toHaveBeenCalledWith(
      null,
      '',
      `/wiki/${next?.section ?? ''}/${next?.path.split('/').at(-1)?.replace('.md', '') ?? ''}`,
    );
  });

  it('tells a screen reader how to walk the web, and hides the legend from it', () => {
    renderWeb();

    expect(stage()).toHaveAccessibleDescription('Use the arrow keys to move between pages.');
    expect(screen.getByText('Concept').closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
