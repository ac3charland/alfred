import { type Point, WIKI_WEB_FORCES } from './forces';
import {
  DRAG_THRESHOLD,
  type View,
  fitView,
  glideTo,
  movedPastThreshold,
  pinchView,
  revealNode,
  toScreen,
  toWorld,
  wheelZoom,
  zoomAt,
} from './view';

const VIEW: View = { scale: 0.5, x: 600, y: 380 };

/** A grid of dot centres `columns` across and `rows` down, `gap` apart, round the origin. */
const grid = (columns: number, rows: number, gap = 120): Point[] =>
  Array.from({ length: columns * rows }, (_, index) => ({
    x: (index % columns) * gap - 400,
    y: Math.floor(index / columns) * gap - 250,
  }));

/** The dots' bounding box, as its top-left and bottom-right corners. */
function boxOf(points: readonly Point[]): [Point, Point] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
  ];
}

/** Where the dots' box lands on the stage under `view`: its top-left and bottom-right. */
function screenBox(view: View, points: readonly Point[]): [Point, Point] {
  const [topLeft, bottomRight] = boxOf(points);
  return [toScreen(view, topLeft), toScreen(view, bottomRight)];
}

describe('toScreen and toWorld', () => {
  it('maps a world point through the view onto the stage', () => {
    expect(toScreen(VIEW, { x: 200, y: 200 })).toStrictEqual({ x: 700, y: 480 });
  });

  it('maps a point on the stage back through the view into the world', () => {
    expect(toWorld(VIEW, { x: 700, y: 480 })).toStrictEqual({ x: 200, y: 200 });
  });

  it('undoes the view: a world point shown on the stage maps back to itself', () => {
    const world = { x: -123.5, y: 42 };

    expect(toWorld(VIEW, toScreen(VIEW, world))).toStrictEqual(world);
  });
});

describe('fitView', () => {
  const stage = { width: 736, height: 440 };
  const { fitPadding, labelAllowance, minScale } = WIKI_WEB_FORCES;

  it('fits the dots, the padding and room for the lowest name into the stage, filling it one way', () => {
    const points = grid(8, 6);
    const view = fitView(points, stage);
    const [topLeft, bottomRight] = screenBox(view, points);

    expect(view.scale).toBeLessThan(1);
    expect(view.scale).toBeGreaterThan(minScale);
    expect(topLeft.x).toBeGreaterThanOrEqual(fitPadding - 1e-9);
    expect(topLeft.y).toBeGreaterThanOrEqual(fitPadding - 1e-9);
    expect(bottomRight.x).toBeLessThanOrEqual(stage.width - fitPadding + 1e-9);
    expect(bottomRight.y + labelAllowance).toBeLessThanOrEqual(stage.height - fitPadding + 1e-9);
    // Tight in whichever direction binds.
    const spare = Math.min(
      stage.width - 2 * fitPadding - (bottomRight.x - topLeft.x),
      stage.height - 2 * fitPadding - labelAllowance - (bottomRight.y - topLeft.y),
    );
    expect(spare).toBeCloseTo(0, 6);
  });

  it('keeps the padding and the name allowance in screen pixels, whatever the scale', () => {
    // Wide: the width binds, so the dots' box sits exactly the padding from each side.
    const wide = grid(12, 2, 200);
    const [wideLeft, wideRight] = screenBox(fitView(wide, stage), wide);
    expect(wideLeft.x).toBeCloseTo(fitPadding, 6);
    expect(stage.width - wideRight.x).toBeCloseTo(fitPadding, 6);

    // Tall: the height binds, so the box sits the padding from the top and the padding plus the
    // allowance from the bottom.
    const tall = grid(2, 8, 100);
    const [tallTop, tallBottom] = screenBox(fitView(tall, stage), tall);
    expect(tallTop.y).toBeCloseTo(fitPadding, 6);
    expect(stage.height - tallBottom.y).toBeCloseTo(fitPadding + labelAllowance, 6);
  });

  it('centres the dots, and the allowance under them, in the stage', () => {
    const points = grid(8, 6);
    const view = fitView(points, stage);
    const [topLeft, bottomRight] = screenBox(view, points);

    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(stage.width / 2, 6);
    expect((topLeft.y + bottomRight.y + labelAllowance) / 2).toBeCloseTo(stage.height / 2, 6);
  });

  it('never scales above 1:1, however much room there is, and still centres the content', () => {
    const points = [
      { x: 300, y: -40 },
      { x: 340, y: 20 },
    ];
    const view = fitView(points, stage);
    const [topLeft, bottomRight] = screenBox(view, points);

    expect(view.scale).toBe(1);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(stage.width / 2, 6);
    expect((topLeft.y + bottomRight.y + labelAllowance) / 2).toBeCloseTo(stage.height / 2, 6);
  });

  it('never scales below the minimum: past it the box overflows, still centred', () => {
    const points = grid(30, 20, 200);
    const view = fitView(points, stage);
    const [topLeft, bottomRight] = screenBox(view, points);

    expect(view.scale).toBe(minScale);
    expect(topLeft.x).toBeLessThan(0);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(stage.width / 2, 6);
    expect((topLeft.y + bottomRight.y + labelAllowance) / 2).toBeCloseTo(stage.height / 2, 6);
  });

  it('zooms out as more dots join', () => {
    const scales = [2, 4, 9, 16, 25, 36].map((count) => {
      const side = Math.ceil(Math.sqrt(count));
      return fitView(grid(side, side).slice(0, count), stage).scale;
    });

    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeLessThanOrEqual(scales[index - 1] ?? 0);
    }
    expect(scales.at(-1)).toBeLessThan(scales[0] ?? 0);
  });

  it('puts the world origin at the stage centre, at 1:1, with no dots', () => {
    expect(fitView([], stage)).toStrictEqual({ scale: 1, x: 368, y: 220 });
  });

  it('puts a lone dot at the exact middle of the stage, at 1:1, name allowance and all', () => {
    const lone = { x: 300, y: -40 };
    const view = fitView([lone], stage);

    expect(view.scale).toBe(1);
    expect(toScreen(view, lone)).toStrictEqual({ x: stage.width / 2, y: stage.height / 2 });
  });

  it('lets a row of dots fit by its width alone, and a column by its height alone', () => {
    // A zero-size axis has nothing to fit; the other axis decides.
    const row = Array.from({ length: 6 }, (_, index) => ({ x: index * 300, y: 10 }));
    const column = Array.from({ length: 6 }, (_, index) => ({ x: -5, y: index * 200 }));

    expect(fitView(row, stage).scale).toBeCloseTo((stage.width - 2 * fitPadding) / 1500, 9);
    expect(fitView(column, stage).scale).toBeCloseTo(
      (stage.height - 2 * fitPadding - labelAllowance) / 1000,
      9,
    );
  });

  it('does not let a row of dots be undone by a stage with no height to spare', () => {
    // Nothing is left of the height once the padding and the name allowance are taken: a zero
    // extent over zero room is not a number, and must not become the scale.
    const row = Array.from({ length: 6 }, (_, index) => ({ x: index * 300, y: 10 }));
    const flat = { width: stage.width, height: 2 * fitPadding + labelAllowance };
    const squashed = { width: stage.width, height: 10 };

    expect(fitView(row, flat).scale).toBeCloseTo((stage.width - 2 * fitPadding) / 1500, 9);
    expect(fitView(row, squashed).scale).toBeCloseTo((stage.width - 2 * fitPadding) / 1500, 9);
  });

  it('stays a number on a stage not yet measured', () => {
    const view = fitView(grid(2, 2), { width: 0, height: 0 });

    expect(view.scale).toBe(minScale);
    expect(Number.isFinite(view.x) && Number.isFinite(view.y)).toBe(true);
  });
});

describe('zoomAt', () => {
  it('scales by the factor', () => {
    expect(zoomAt(VIEW, { x: 0, y: 0 }, 1.5).scale).toBeCloseTo(0.75);
  });

  it('keeps the world point under the pointer where it was', () => {
    const pointer = { x: 250, y: 610 };
    const under = toWorld(VIEW, pointer);

    const zoomed = zoomAt(VIEW, pointer, 1.7);

    const after = toScreen(zoomed, under);
    expect(after.x).toBeCloseTo(pointer.x);
    expect(after.y).toBeCloseTo(pointer.y);
  });

  it('stops at the limits, still holding the point under the pointer', () => {
    const pointer = { x: 250, y: 610 };
    const under = toWorld(VIEW, pointer);

    const far = zoomAt(VIEW, pointer, 0.01);
    const near = zoomAt(VIEW, pointer, 100);

    expect(far.scale).toBe(WIKI_WEB_FORCES.minScale);
    expect(near.scale).toBe(WIKI_WEB_FORCES.maxScale);
    expect(toScreen(near, under).x).toBeCloseTo(pointer.x);
    expect(toScreen(near, under).y).toBeCloseTo(pointer.y);
  });
});

describe('wheelZoom', () => {
  const PIXELS = 0;
  const LINES = 1;
  const PAGES = 2;

  it('zooms out as the wheel turns toward the reader, and in as it turns away', () => {
    expect(wheelZoom({ deltaY: 100, deltaMode: PIXELS, ctrlKey: false })).toBeLessThan(1);
    expect(wheelZoom({ deltaY: -100, deltaMode: PIXELS, ctrlKey: false })).toBeGreaterThan(1);
    expect(wheelZoom({ deltaY: 0, deltaMode: PIXELS, ctrlKey: false })).toBe(1);
  });

  it('turns one notch of a mouse wheel into a step of about an eighth', () => {
    expect(wheelZoom({ deltaY: 100, deltaMode: PIXELS, ctrlKey: false })).toBeCloseTo(0.87, 2);
  });

  it('reads the same turn the same way in pixels, lines or pages', () => {
    const inPixels = wheelZoom({ deltaY: 100, deltaMode: PIXELS, ctrlKey: false });

    expect(wheelZoom({ deltaY: 4, deltaMode: LINES, ctrlKey: false })).toBeCloseTo(inPixels);
    expect(wheelZoom({ deltaY: 0.2, deltaMode: PAGES, ctrlKey: false })).toBeCloseTo(inPixels);
  });

  it('zooms faster for a trackpad pinch, whose small deltas arrive with ctrlKey', () => {
    const pinch = wheelZoom({ deltaY: 10, deltaMode: PIXELS, ctrlKey: true });
    const wheel = wheelZoom({ deltaY: 10, deltaMode: PIXELS, ctrlKey: false });

    expect(pinch).toBeLessThan(wheel);
    expect(pinch).toBeCloseTo(wheelZoom({ deltaY: 100, deltaMode: PIXELS, ctrlKey: false }));
  });
});

describe('pinchView', () => {
  it('scales by how far the fingers have spread', () => {
    const view = pinchView(
      VIEW,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 50, y: 100 },
        { x: 250, y: 100 },
      ],
    );

    expect(view.scale).toBeCloseTo(1);
  });

  it('keeps the world point between the fingers between them as they move', () => {
    const from = [
      { x: 100, y: 100 },
      { x: 200, y: 160 },
    ] as const;
    const to = [
      { x: 300, y: 420 },
      { x: 420, y: 500 },
    ] as const;
    const between = toWorld(VIEW, { x: 150, y: 130 });

    const view = pinchView(VIEW, from, to);

    const after = toScreen(view, between);
    expect(after.x).toBeCloseTo(360);
    expect(after.y).toBeCloseTo(460);
  });

  it('stays within the zoom limits', () => {
    const shrunk = pinchView(
      VIEW,
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    );
    const grown = pinchView(
      VIEW,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
    );

    expect(shrunk.scale).toBe(WIKI_WEB_FORCES.minScale);
    expect(grown.scale).toBe(WIKI_WEB_FORCES.maxScale);
  });

  it('holds the scale when the fingers start on one spot', () => {
    const spot = { x: 10, y: 10 };

    expect(pinchView(VIEW, [spot, spot], [spot, { x: 90, y: 10 }]).scale).toBe(VIEW.scale);
  });
});

describe('movedPastThreshold', () => {
  it('is a click until the pointer has moved more than 4 px from where it went down', () => {
    const start = { x: 100, y: 100 };

    expect(DRAG_THRESHOLD).toBe(4);
    expect(movedPastThreshold(start, { x: 104, y: 100 })).toBe(false);
    expect(movedPastThreshold(start, { x: 103, y: 102.6 })).toBe(false);
    expect(movedPastThreshold(start, { x: 103, y: 103 })).toBe(true);
    expect(movedPastThreshold(start, { x: 95, y: 100 })).toBe(true);
  });
});

describe('glideTo', () => {
  const TARGET: View = { scale: 1, x: 0, y: 0 };

  it('moves the view the given share of the way to the target, scale included', () => {
    expect(glideTo(VIEW, TARGET, 0.25)).toStrictEqual({ scale: 0.625, x: 450, y: 285 });
  });

  it('arrives when the share is the whole way', () => {
    expect(glideTo(VIEW, TARGET, 1)).toStrictEqual(TARGET);
  });

  it('holds a world point on a straight line between where the two views put it', () => {
    const world = { x: 320, y: -140 };
    const [from, to] = [toScreen(VIEW, world), toScreen(TARGET, world)];

    const halfway = toScreen(glideTo(VIEW, TARGET, 0.5), world);

    expect(halfway.x).toBeCloseTo((from.x + to.x) / 2);
    expect(halfway.y).toBeCloseTo((from.y + to.y) / 2);
  });
});

describe('revealNode', () => {
  const STAGE = { width: 1000, height: 600 };
  const PADDING = 24;
  const RADIUS = 9;

  /** A dot's circle on the stage, as its bounding box: its size is the same at every scale. */
  const dotBoxOn = (view: View, point: Point, radius = RADIUS) => {
    const centre = toScreen(view, point);
    return {
      left: centre.x - radius,
      top: centre.y - radius,
      right: centre.x + radius,
      bottom: centre.y + radius,
    };
  };

  it('leaves the view alone when the dot is inside the stage, even inside the padding', () => {
    // Its left edge is 10 px in: inside the stage, if not with room to spare.
    const point = { x: (10 + RADIUS - VIEW.x) / VIEW.scale, y: 200 };

    expect(revealNode(VIEW, point, RADIUS, STAGE, PADDING)).toBe(VIEW);
  });

  it.each([
    ['left', { x: -1800, y: 200 }],
    ['right', { x: 1900, y: 200 }],
    ['top', { x: 400, y: -1200 }],
    ['bottom', { x: 400, y: 1500 }],
    ['top left', { x: -1800, y: -1200 }],
    ['bottom right', { x: 1900, y: 1500 }],
  ])('brings a dot past the %s edge in, with the padding to spare', (_side, point) => {
    const outside = dotBoxOn(VIEW, point);
    expect(
      outside.left < 0 ||
        outside.top < 0 ||
        outside.right > STAGE.width ||
        outside.bottom > STAGE.height,
    ).toBe(true);

    const view = revealNode(VIEW, point, RADIUS, STAGE, PADDING);

    const box = dotBoxOn(view, point);
    expect(view.scale).toBe(VIEW.scale);
    expect(box.left).toBeGreaterThanOrEqual(PADDING - 1e-9);
    expect(box.top).toBeGreaterThanOrEqual(PADDING - 1e-9);
    expect(box.right).toBeLessThanOrEqual(STAGE.width - PADDING + 1e-9);
    expect(box.bottom).toBeLessThanOrEqual(STAGE.height - PADDING + 1e-9);
  });

  it('moves it by the least that does: the near edge lands on the padding, the other axis stays', () => {
    const point = { x: -1800, y: 200 };

    const view = revealNode(VIEW, point, RADIUS, STAGE, PADDING);

    expect(dotBoxOn(view, point).left).toBeCloseTo(PADDING);
    expect(view.y).toBe(VIEW.y);
  });

  it('brings a dot that is only partly outside in from that side', () => {
    const point = { x: (STAGE.width - 4 - VIEW.x) / VIEW.scale, y: 200 };

    const view = revealNode(VIEW, point, RADIUS, STAGE, PADDING);

    expect(dotBoxOn(view, point).right).toBeCloseTo(STAGE.width - PADDING);
    expect(view.y).toBe(VIEW.y);
  });

  it('takes the radius as screen pixels, so the same spot on the stage shifts the same at any zoom', () => {
    // Two views that put the dot's centre at the same place on the stage, 5 px from the edge.
    const near: View = { scale: 0.5, x: 5, y: 300 };
    const far: View = { scale: 2, x: 5, y: 300 };
    const point = { x: 0, y: 0 };

    expect(revealNode(near, point, RADIUS, STAGE, PADDING).x).toBe(
      revealNode(far, point, RADIUS, STAGE, PADDING).x,
    );
    // The dot's edge, RADIUS past its centre, is what is brought to the padding.
    expect(revealNode(near, point, RADIUS, STAGE, PADDING).x).toBe(PADDING + RADIUS);
  });

  it('shows the start of a dot too big for the stage', () => {
    const point = { x: 100, y: 20 };
    const view = revealNode(
      { scale: 2, x: 0, y: 0 },
      point,
      300,
      { width: 300, height: 200 },
      PADDING,
    );

    expect(dotBoxOn(view, point, 300).left).toBeCloseTo(PADDING);
    expect(dotBoxOn(view, point, 300).top).toBeCloseTo(PADDING);
  });
});
