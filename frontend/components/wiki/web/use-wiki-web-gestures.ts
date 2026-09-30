'use client';

import * as React from 'react';

import type { Point } from '@/lib/wiki/web/forces';
import { type View, movedPastThreshold, pinchView, wheelZoom, zoomAt } from '@/lib/wiki/web/view';

import type { WikiWebStage } from './wiki-web-stage';

/** What the pointer holds: a node being dragged, the stage being panned, or neither. */
export type WikiWebHold = { kind: 'node'; id: string } | { kind: 'pan' } | null;

/** A mouse or pen pressed on the stage, until it moves past the threshold or lifts. */
interface Press {
  pointerId: number;
  /** Where it went down, on the stage. */
  start: Point;
  /** The node it went down on, or `null` for empty stage. */
  node: string | null;
  /** Past the threshold: a drag (on a node) or a pan (on empty stage), never a click. */
  moving: boolean;
  /** For a pan: the view when it began, and where the pointer went down. */
  panFrom: { view: View; pointer: Point } | undefined;
}

/** Two fingers on the stage, and the view when the second went down. */
interface Pinch {
  pointers: readonly [number, number];
  from: readonly [Point, Point];
  view: View;
}

/** The node an event landed in, by path, or `null` for empty stage. */
function nodeOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest<HTMLElement>('[data-wiki-node]');
  if (!node) return null;
  const { wikiNode = null } = node.dataset;
  return wikiNode;
}

/** How long a touch may take to synthesize the click that ends a drag or a pinch, in ms. */
const CLICK_GUARD_MS = 400;

/**
 * The web's pointer and wheel handling, on the stage element `ref` holds.
 *
 * A mouse or pen press on a node that moves more than 4 px drags the node; on empty stage it
 * pans the view. Two fingers pinch and pan it. Zoom is cooperative, as embedded maps do it,
 * because the landing scrolls: a trackpad pinch (a wheel with `ctrlKey`) or a wheel with ⌘ or
 * Ctrl held zooms about the pointer, and a plain wheel is left alone to scroll the page. On
 * touch, one finger belongs to the page (the stage is `touch-action: pan-y`): it scrolls, and a
 * tap on a node is the link's own click. A node can't be dragged by touch.
 *
 * Clicks on a node are the link's own: the click that ends a drag or a pinch never reaches it,
 * however long a touch takes to send it — but a click elsewhere on the page is never held back.
 * Moves and releases are followed on the window, so a drag carries on when the pointer runs off
 * the stage. The wheel listener isn't passive, so it can keep the page still while it zooms.
 */
export function useWikiWebGestures(
  ref: React.RefObject<HTMLElement | null>,
  stage: WikiWebStage,
  onHold: (hold: WikiWebHold) => void,
): void {
  const latest = React.useRef(onHold);
  React.useEffect(() => {
    latest.current = onHold;
  });

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const pointers = new Map<number, Point>();
    let press: Press | undefined;
    let pinch: Pinch | undefined;
    let clickGuard: ReturnType<typeof setTimeout> | undefined;

    const onStage = (event: MouseEvent): Point => {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    // The click a drag ends with still lands on the node under the pointer — at once for a
    // mouse, some time later for a touch. As d3-drag does, swallow it on its way down, before
    // React sees it: the next one on the stage, until a press starts anywhere on the page or the
    // click has had time to come.
    const unguardClick = () => {
      clearTimeout(clickGuard);
      clickGuard = undefined;
      globalThis.removeEventListener('click', swallowClick, true);
    };
    const swallowClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !element.contains(event.target)) return;
      event.stopPropagation();
      event.preventDefault();
      unguardClick();
    };
    const guardClick = () => {
      unguardClick();
      globalThis.addEventListener('click', swallowClick, true);
      clickGuard = setTimeout(unguardClick, CLICK_GUARD_MS);
    };

    const startPinch = () => {
      const [first, second] = [...pointers];
      if (!first || !second) return;
      if (press?.moving) latest.current(null);
      press = undefined;
      pinch = { pointers: [first[0], second[0]], from: [first[1], second[1]], view: stage.view() };
    };

    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      // A mouse whose button came up where the page couldn't hear it (another window took the
      // release) is no longer pressing: end what it was doing rather than drag on regardless.
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        finish(event);
        return;
      }
      const point = onStage(event);
      pointers.set(event.pointerId, point);

      if (pinch) {
        const first = pointers.get(pinch.pointers[0]);
        const second = pointers.get(pinch.pointers[1]);
        if (first && second) stage.setView(pinchView(pinch.view, pinch.from, [first, second]));
        return;
      }
      if (press?.pointerId !== event.pointerId) return;

      if (!press.moving) {
        if (!movedPastThreshold(press.start, point)) return;
        press.moving = true;
        if (press.node === null) {
          press.panFrom = { view: stage.view(), pointer: press.start };
          latest.current({ kind: 'pan' });
        } else if (stage.grab(press.node, press.start)) {
          latest.current({ kind: 'node', id: press.node });
        } else {
          press = undefined;
          return;
        }
      }

      if (press.panFrom) {
        const { view, pointer } = press.panFrom;
        stage.setView({
          ...view,
          x: view.x + point.x - pointer.x,
          y: view.y + point.y - pointer.y,
        });
      } else {
        stage.drag(point);
      }
    };

    const unlisten = () => {
      globalThis.removeEventListener('pointermove', move);
      // A lift and a cancel end a press alike: only a drag or a pan does anything as it ends.
      globalThis.removeEventListener('pointerup', finish);
      globalThis.removeEventListener('pointercancel', finish);
    };

    const finish = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pinch) {
        if (pinch.pointers.includes(event.pointerId)) {
          pinch = undefined;
          guardClick();
        }
      } else if (press?.pointerId === event.pointerId) {
        const ended = press;
        press = undefined;
        if (ended.moving) {
          if (ended.node !== null) stage.release();
          latest.current(null);
          guardClick();
        }
      }
      if (pointers.size === 0) unlisten();
    };

    const listen = () => {
      globalThis.addEventListener('pointermove', move);
      globalThis.addEventListener('pointerup', finish);
      globalThis.addEventListener('pointercancel', finish);
    };

    const down = (event: PointerEvent) => {
      // The primary button, a finger or a pen; a right-click is the browser's.
      if (event.button !== 0) return;
      // A press whose release never arrived ends here, before the new one starts.
      if (pointers.has(event.pointerId)) finish(event);
      const point = onStage(event);
      pointers.set(event.pointerId, point);
      if (pointers.size === 1) listen();
      if (event.pointerType === 'touch') {
        // One finger is the page's; a second makes a pinch.
        if (pointers.size === 2) startPinch();
        return;
      }
      if (pointers.size === 1) {
        press = {
          pointerId: event.pointerId,
          start: point,
          node: nodeOf(event.target),
          moving: false,
          panFrom: undefined,
        };
      }
    };

    const wheel = (event: WheelEvent) => {
      // A plain wheel scrolls the page; only a pinch (ctrlKey) or ⌘/Ctrl + wheel zooms the web.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      stage.setView(zoomAt(stage.view(), onStage(event), wheelZoom(event)));
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('wheel', wheel, { passive: false });
    // Whatever click a drag was owed, a press anywhere on the page is not it.
    globalThis.addEventListener('pointerdown', unguardClick, true);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('wheel', wheel);
      globalThis.removeEventListener('pointerdown', unguardClick, true);
      unlisten();
      unguardClick();
    };
  }, [ref, stage]);
}
