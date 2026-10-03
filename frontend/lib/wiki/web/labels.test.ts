import { WIKI_WEB_FORCES, WIKI_WEB_LABELS } from './forces';
import { type LabelNode, type LabelPlacement, placeLabels, truncateName } from './labels';

const STAGE = { width: 800, height: 400 };
const LINE = WIKI_WEB_LABELS.lineHeight;
const GAP = WIKI_WEB_LABELS.gap;

const node = (id: string, x: number, y: number, extra: Partial<LabelNode> = {}): LabelNode => ({
  id,
  x,
  y,
  radius: 5,
  width: 80,
  degree: 1,
  ...extra,
});

/** `placeLabels` with the quiet defaults: nothing lit, zoomed out, on the stage. */
function place(
  nodes: readonly LabelNode[],
  options: {
    litId?: string;
    neighbours?: readonly string[];
    scale?: number;
    stage?: { width: number; height: number };
  } = {},
): Map<string, LabelPlacement> {
  return placeLabels({
    nodes,
    litId: options.litId ?? null,
    neighbours: new Set(options.neighbours),
    scale: options.scale ?? 0.5,
    stage: options.stage ?? STAGE,
  });
}

/** The ids that show, as a set: which names show, whatever order they were placed in. */
const shown = (placements: ReadonlyMap<string, LabelPlacement>): Set<string> =>
  new Set(placements.keys());

/** A name's box on the stage: where `placement` puts it from its dot's centre. */
function boxOf(dot: LabelNode, placement: LabelPlacement | undefined) {
  if (!placement) throw new Error(`${dot.id} is not shown`);
  const left = dot.x + placement.dx;
  const top = dot.y + placement.dy;
  return { left, top, right: left + dot.width, bottom: top + LINE };
}

describe('truncateName', () => {
  it('leaves a title of up to 28 characters alone', () => {
    expect(truncateName('Zone 2 training')).toBe('Zone 2 training');
    expect(truncateName('a'.repeat(WIKI_WEB_LABELS.maxLength))).toBe(
      'a'.repeat(WIKI_WEB_LABELS.maxLength),
    );
    expect(truncateName('')).toBe('');
  });

  it('cuts a longer title to its first 27 characters and an ellipsis', () => {
    expect(truncateName('a'.repeat(29))).toBe(`${'a'.repeat(27)}…`);
    expect(truncateName('Why every retrieval-augmented system forgets')).toBe(
      'Why every retrieval-augment…',
    );
  });

  it('never cuts a character in half, however many code points it takes', () => {
    // An emoji is two UTF-16 units, a family of three is eight code points joined by zero-width
    // joiners, and an accent can be a code point of its own: each counts as one character.
    const brain = '🧠';
    const family = '👨‍👩‍👧';
    const accented = 'e\u0301';

    for (const character of [brain, family, accented]) {
      expect(truncateName(character.repeat(29))).toBe(`${character.repeat(27)}…`);
      expect(truncateName(character.repeat(28))).toBe(character.repeat(28));
    }
  });
});

describe('placeLabels: which names show', () => {
  // The day's concept with three neighbours, and two dots that have nothing to do with it.
  const web = [
    node('focus', 400, 200),
    node('n1', 300, 120),
    node('n2', 500, 120),
    node('n3', 400, 320),
    node('far1', 100, 60),
    node('far2', 700, 340),
  ];

  it('names only the lit dot and its neighbours, zoomed out', () => {
    const placements = place(web, {
      litId: 'focus',
      neighbours: ['n1', 'n2', 'n3'],
    });

    expect(shown(placements)).toStrictEqual(new Set(['focus', 'n1', 'n2', 'n3']));
  });

  it('names neither the day’s concept nor its neighbours when another dot is lit', () => {
    const placements = place(web, {
      litId: 'far1',
      neighbours: ['far2'],
    });

    expect(shown(placements)).toStrictEqual(new Set(['far1', 'far2']));
  });

  it('names nothing when nothing is lit and the view is zoomed out', () => {
    expect(place(web).size).toBe(0);
  });

  it('names every dot on the stage from the zoom where all names show, and none off it', () => {
    const dots = [
      node('a', 100, 100),
      node('b', 300, 100),
      node('c', 500, 100),
      node('d', 700, 300),
      node('left', -50, 100),
      node('below', 400, 500),
      node('right', 850, 100),
      node('above', 400, -20),
    ];

    const atThreshold = place(dots, { scale: WIKI_WEB_FORCES.allNamesScale });
    const justBelow = place(dots, { scale: WIKI_WEB_FORCES.allNamesScale - 0.01 });

    expect(shown(atThreshold)).toStrictEqual(new Set(['a', 'b', 'c', 'd']));
    expect(justBelow.size).toBe(0);
    expect(shown(place(dots, { scale: 3 }))).toStrictEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('counts a dot on the very edge of the stage as on it', () => {
    const dots = [node('corner', 0, 0), node('opposite', 800, 400)];

    expect(shown(place(dots, { scale: 1 }))).toStrictEqual(new Set(['corner', 'opposite']));
  });

  it('keeps the lit dots’ names alongside all the others when zoomed in', () => {
    const placements = place(web, {
      litId: 'focus',
      neighbours: ['n1', 'n2', 'n3'],
      scale: 1.5,
    });

    expect(shown(placements)).toStrictEqual(new Set(['far1', 'far2', 'focus', 'n1', 'n2', 'n3']));
  });

  it('shows nothing for an empty web, and shrugs off a lit dot it does not hold', () => {
    expect(place([]).size).toBe(0);
    expect(
      shown(
        place([node('a', 100, 100)], {
          litId: 'gone',
          neighbours: ['not-here'],
        }),
      ),
    ).toStrictEqual(new Set());
  });
});

describe('placeLabels: where a name sits', () => {
  it('centres an ordinary name under its dot, a gap below its edge', () => {
    const dot = node('a', 300, 150, { radius: 9, width: 90 });

    const box = boxOf(dot, place([dot], { scale: 1 }).get('a'));

    expect(box.left).toBeCloseTo(300 - 45, 9);
    expect(box.right).toBeCloseTo(300 + 45, 9);
    expect(box.top).toBeCloseTo(150 + 9 + GAP, 9);
    expect(box.bottom - box.top).toBe(LINE);
  });

  describe('a neighbour of the lit dot', () => {
    const lit = node('lit', 400, 200);

    /**
     * The four ways a neighbour's name can sit from the anchor point, one dot's radius and a gap
     * out from its dot along the line from the lit dot.
     */
    const sit = {
      start: (anchor: { x: number; y: number }, _width: number) => ({
        left: anchor.x,
        top: anchor.y - LINE / 2,
      }),
      end: (anchor: { x: number; y: number }, width: number) => ({
        left: anchor.x - width,
        top: anchor.y - LINE / 2,
      }),
      below: (anchor: { x: number; y: number }, width: number) => ({
        left: anchor.x - width / 2,
        top: anchor.y,
      }),
      above: (anchor: { x: number; y: number }, width: number) => ({
        left: anchor.x - width / 2,
        top: anchor.y - LINE,
      }),
    };

    it.each([
      ['to the right', { x: 100, y: 0 }, 'start'],
      ['to the left', { x: -100, y: 0 }, 'end'],
      ['below', { x: 0, y: 100 }, 'below'],
      ['above', { x: 0, y: -100 }, 'above'],
      ['below and right, steeply enough to start the name', { x: 60, y: 80 }, 'start'],
      ['above and left, steeply enough to end the name', { x: -60, y: -80 }, 'end'],
      ['below, just inside the centred band', { x: 30, y: 90 }, 'below'],
      ['below, just outside the centred band', { x: 40, y: 90 }, 'start'],
      ['above, just inside the centred band', { x: -30, y: -90 }, 'above'],
      ['above, just outside the centred band', { x: -40, y: -90 }, 'end'],
    ] as const)(
      'puts its name outward from the lit dot, past its own dot: %s',
      (_where, offset, anchoring) => {
        const neighbour = node('n', lit.x + offset.x, lit.y + offset.y, { radius: 7, width: 70 });
        const length = Math.hypot(offset.x, offset.y);
        const anchor = {
          x: neighbour.x + (offset.x / length) * (7 + GAP),
          y: neighbour.y + (offset.y / length) * (7 + GAP),
        };
        const expected = sit[anchoring](anchor, 70);

        const box = boxOf(
          neighbour,
          place([lit, neighbour], { litId: 'lit', neighbours: ['n'] }).get('n'),
        );

        expect(box.left).toBeCloseTo(expected.left, 9);
        expect(box.top).toBeCloseTo(expected.top, 9);
      },
    );

    it('centres the name under the dot when it sits exactly on the lit one', () => {
      // A wide lit dot, so its own name is set too far down to collide with the neighbour's.
      const wide = node('lit', 400, 200, { radius: 30 });
      const neighbour = node('n', 400, 200, { width: 70 });

      const box = boxOf(
        neighbour,
        place([wide, neighbour], { litId: 'lit', neighbours: ['n'] }).get('n'),
      );

      expect(box.left).toBeCloseTo(365, 9);
      expect(box.top).toBeCloseTo(200 + 5 + GAP, 9);
    });

    it('sits the lit dot’s own name under it, not outward, even when it lists itself as a neighbour', () => {
      const dot = node('lit', 400, 200, { width: 60 });

      const box = boxOf(dot, place([dot], { litId: 'lit', neighbours: ['lit'] }).get('lit'));

      expect(box.left).toBeCloseTo(370, 9);
      expect(box.top).toBeCloseTo(200 + 5 + GAP, 9);
    });
  });

  describe('near the left and right sides of the stage', () => {
    it('nudges a centred name that would cross the left side back inside', () => {
      const dot = node('a', 20, 200, { width: 80 });

      const box = boxOf(dot, place([dot], { scale: 1 }).get('a'));

      expect(box.left).toBe(0);
      expect(box.right).toBe(80);
    });

    it('nudges a centred name that would cross the right side back inside', () => {
      const dot = node('a', 790, 200, { width: 80 });

      const box = boxOf(dot, place([dot], { scale: 1 }).get('a'));

      expect(box.right).toBe(STAGE.width);
      expect(box.left).toBe(STAGE.width - 80);
    });

    it('flips an outward name that would cross a side to its dot’s other side, never over the dot', () => {
      const lit = node('lit', 100, 200);
      const neighbour = node('n', 30, 200, { width: 90 });

      const box = boxOf(
        neighbour,
        place([lit, neighbour], { litId: 'lit', neighbours: ['n'] }).get('n'),
      );

      // Anchored to end 9 px left of its dot it would run from -69, so it starts 9 px right of it.
      expect(box.left).toBeCloseTo(39, 9);
      expect(box.right).toBeCloseTo(129, 9);
      expect(box.top).toBeCloseTo(200 - LINE / 2, 9);
    });

    it('nudges an outward name back inside, its height unmoved, when neither side of its dot fits', () => {
      const lit = node('lit', 100, 200);
      const neighbour = node('n', 30, 200, { width: 780 });

      const box = boxOf(
        neighbour,
        place([lit, neighbour], { litId: 'lit', neighbours: ['n'] }).get('n'),
      );

      expect(box.left).toBe(0);
      expect(box.top).toBeCloseTo(200 - LINE / 2, 9);
    });

    it('leaves a name that fits wholly inside exactly where it was', () => {
      const dot = node('a', 400, 200, { width: 80, radius: 6 });

      const placement = place([dot], { scale: 1 }).get('a');

      expect(placement).toStrictEqual({ dx: -40, dy: 6 + GAP });
    });

    it('keeps the start of a name wider than the stage', () => {
      const dot = node('a', 400, 200, { width: 900 });

      const box = boxOf(dot, place([dot], { scale: 1 }).get('a'));

      expect(box.left).toBe(0);
    });
  });
});

describe('placeLabels: culling overlaps', () => {
  const zoomedIn = { scale: 1 };

  it('hides a name whose box overlaps one already placed', () => {
    // 40 px apart, 80 px wide: the two names share half their width.
    const dots = [node('a', 300, 200), node('b', 340, 200)];

    expect(place(dots, zoomedIn).size).toBe(1);
  });

  it('keeps names whose boxes only touch, or that clear each other', () => {
    const touching = [node('a', 100, 200), node('b', 180, 200)];
    const apart = [node('a', 100, 200), node('b', 100, 200 + LINE)];

    expect(shown(place(touching, zoomedIn))).toStrictEqual(new Set(['a', 'b']));
    expect(shown(place(apart, zoomedIn))).toStrictEqual(new Set(['a', 'b']));
  });

  it('hides a name overlapping only a little in height', () => {
    const dots = [node('a', 100, 200), node('b', 100, 200 + LINE - 1)];

    expect(place(dots, zoomedIn).size).toBe(1);
  });

  it('judges overlap by the names’ measured widths', () => {
    const wide = [node('a', 300, 200, { width: 120 }), node('b', 380, 200, { width: 120 })];
    const narrow = [node('a', 300, 200, { width: 60 }), node('b', 380, 200, { width: 60 })];

    expect(place(wide, zoomedIn).size).toBe(1);
    expect(place(narrow, zoomedIn).size).toBe(2);
  });

  it('keeps the dot of higher degree', () => {
    const dots = [node('a', 300, 200, { degree: 1 }), node('b', 340, 200, { degree: 5 })];

    expect(shown(place(dots, zoomedIn))).toStrictEqual(new Set(['b']));
  });

  it('breaks a tie of degree by id, the lower id first', () => {
    const dots = [node('b', 340, 200, { degree: 3 }), node('a', 300, 200, { degree: 3 })];

    expect(shown(place(dots, zoomedIn))).toStrictEqual(new Set(['a']));
  });

  it('places greedily, most important first, even where fewer names then show', () => {
    // a and c clear each other, but b, the highest degree, overlaps both and goes first.
    const dots = [
      node('a', 300, 200, { degree: 5 }),
      node('b', 370, 200, { degree: 9 }),
      node('c', 440, 200, { degree: 4 }),
    ];

    expect(shown(place(dots, zoomedIn))).toStrictEqual(new Set(['b']));
  });

  it('puts the lit dot’s neighbours before every other name, whatever its degree', () => {
    // The neighbour's name is set below it, right where the busy dot's name would go.
    const dots = [
      node('lit', 300, 100),
      node('near', 300, 200, { degree: 0 }),
      node('busy', 310, 202, { degree: 50 }),
    ];

    const placements = place(dots, { ...zoomedIn, litId: 'lit', neighbours: ['near'] });

    expect(shown(placements)).toStrictEqual(new Set(['lit', 'near']));
  });

  it('puts the lit dot’s own name before its neighbours’, whatever their degree', () => {
    // The neighbour is one dot below the lit one, so their names collide.
    const dots = [node('lit', 300, 200, { degree: 0 }), node('n', 300, 205, { degree: 9 })];

    const placements = place(dots, { ...zoomedIn, litId: 'lit', neighbours: ['n'] });

    expect(shown(placements)).toStrictEqual(new Set(['lit']));
  });

  it('puts the lit dot’s own name before every other name, whatever their degree', () => {
    const dots = [node('lit', 300, 200, { degree: 0 }), node('rest', 300, 196, { degree: 9 })];

    const placements = place(dots, { ...zoomedIn, litId: 'lit' });

    expect(shown(placements)).toStrictEqual(new Set(['lit']));
  });

  it('gives the same names whatever order the dots come in', () => {
    const [a, b, c] = [
      node('a', 300, 200, { degree: 2 }),
      node('b', 340, 200, { degree: 2 }),
      node('c', 600, 300, { degree: 1 }),
    ];

    expect(shown(place([c, b, a], zoomedIn))).toStrictEqual(new Set(['a', 'c']));
    expect(shown(place([a, b, c], zoomedIn))).toStrictEqual(new Set(['a', 'c']));
  });
});
