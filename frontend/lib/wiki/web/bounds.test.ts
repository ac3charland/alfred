import { type SimulationNodeDatum, forceSimulation } from 'd3-force';

import { forceBounds } from './bounds';

type Node = SimulationNodeDatum & { id: string; radius: number };

const node = (id: string, x: number, y: number, radius = 6): Node => ({
  id,
  x,
  y,
  vx: 0,
  vy: 0,
  radius,
});

/** Always the same draw, so a tie breaks the same way every time. */
const steady = () => 0.25;

describe('forceBounds', () => {
  const world = { width: 1000, height: 600 };
  const margin = 12;
  const radius = 6;
  const maxX = world.width / 2 - margin - radius;
  const maxY = world.height / 2 - margin - radius;

  it('stops a dot heading out of the world at its margin', () => {
    const right = { ...node('right', maxX - 10, 0, radius), vx: 40 };
    const top = { ...node('top', 0, -maxY + 5, radius), vy: -40 };
    const force = forceBounds<Node>(world, margin);
    force.initialize?.([right, top], steady);

    force(1);

    expect(right.vx).toBe(10);
    expect(top.vy).toBe(-5);
  });

  it('draws a dot outside the world back in', () => {
    const outside = node('outside', -maxX - 100, maxY + 50, radius);
    const force = forceBounds<Node>(world, margin);
    force.initialize?.([outside], steady);

    force(1);

    expect(outside.vx).toBe(100);
    expect(outside.vy).toBe(-50);
  });

  it('leaves a dot well inside alone', () => {
    const inside = { ...node('inside', 20, -20, radius), vx: 5, vy: -5 };
    const force = forceBounds<Node>(world, margin);
    force.initialize?.([inside], steady);

    force(1);

    expect([inside.vx, inside.vy]).toStrictEqual([5, -5]);
  });

  it('keeps the whole dot inside, so a bigger dot stops sooner than a small one', () => {
    // Both are heading right from x = 480 in a world whose edge, less the 12 px margin, is 488:
    // the 3 px dot has room for 5 more, the 9 px dot is already 1 px past its own limit.
    const small = { ...node('small', 480, 0, 3), vx: 30 };
    const big = { ...node('big', 480, 0, 9), vx: 30 };
    const force = forceBounds<Node>(world, margin);
    force.initialize?.([small, big], steady);

    force(1);

    expect(small.vx).toBe(5);
    expect(big.vx).toBe(-1);
  });

  it('holds a dot that fills the world to the centre rather than letting its limit go negative', () => {
    // 20 px across, with a 12 px margin, leaves less than nothing for a 9 px dot.
    const tiny = { width: 20, height: 20 };
    const wide = { ...node('wide', 5, -4, 9), vx: 3, vy: -3 };
    const force = forceBounds<Node>(tiny, margin);
    force.initialize?.([wide], steady);

    force(1);

    expect(wide.vx).toBe(-5);
    expect(wide.vy).toBe(4);
  });

  describe('in a running simulation', () => {
    it('goes where a held dot is held, and draws it back in gently once it is let go', () => {
      const dot: Node = { ...node('held', maxX + 200, 0, radius), fx: maxX + 200, fy: 0 };
      const simulation = forceSimulation<Node>()
        .stop()
        .nodes([dot])
        .force('bounds', forceBounds<Node>(world, margin));

      simulation.tick();
      expect(dot.x).toBe(maxX + 200);

      dot.fx = null;
      simulation.tick();
      // Drawn back, but by a share of the way rather than in one jump.
      expect(dot.x).toBeLessThan(maxX + 200);
      expect(dot.x).toBeGreaterThan(maxX);

      // ...and momentum carries it on inside, where nothing draws it back out.
      for (let tick = 0; tick < 40; tick += 1) simulation.tick();
      expect(dot.x).toBeLessThanOrEqual(maxX);
      expect(dot.x).toBeGreaterThanOrEqual(-maxX);
    });

    it('never lets a dot pushed hard at the edge cross it', () => {
      const pushed = { ...node('pushed', maxX - 1, 0, radius), vx: 500, vy: 0 };
      const simulation = forceSimulation<Node>()
        .stop()
        .nodes([pushed])
        .force('bounds', forceBounds<Node>(world, margin));

      simulation.tick();

      expect(pushed.x).toBeLessThanOrEqual(maxX);
    });
  });
});
