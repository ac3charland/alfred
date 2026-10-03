import { cn } from '@/lib/utils';

/**
 * The web's look, in one place. The stage writes each node's and edge's light as `data-state`
 * (`lit` · `neighbour` · `dim` · `rest`), whether the day's concept is featured — no other node
 * lit — as `data-featured`, and whether a name shows as `data-shown`; React writes `data-kind`
 * and `data-focus`. Every class below keys off those attributes, so a hover restyles
 * the web without React rendering anything. Changes are instant — no transition — since a
 * hundred dots fading at once stutters.
 *
 * Violet means "related to what you're looking at": the focus and whatever is lit. At rest every
 * other dot is muted, a concept filled and an entity a ring, so a second hue never competes with
 * the module colours.
 */

/** The frame round the stage, and the place the Fit button sits over it. */
export const stageFrameClass = 'relative';

/** The stage: a framed, clipped canvas that leaves vertical swipes to the page. */
export const stageClass = cn(
  'relative h-80 w-full overflow-clip rounded-lg border border-border bg-surface sm:h-[440px]',
  // `clip`, not `hidden`: a hidden overflow still scrolls to show a node focused from the
  // keyboard, which would slide the web out from under its view.
  'touch-pan-y select-none cursor-grab',
);

/** The stage while a node is dragged or the view panned. */
export const stageHeldClass = 'cursor-grabbing';

/** The layer the nodes sit in, hidden until the stage has been measured and the web laid out. */
export const nodeLayerClass = 'absolute inset-0';

/** The SVG the edges are drawn in, over the whole stage, in stage pixels. */
export const edgeLayerClass = 'pointer-events-none absolute inset-0 h-full w-full overflow-visible';

/** One edge: a hairline at rest, violet when it touches the lit node, faint while another is. */
export const edgeClass = cn(
  'stroke-muted-foreground/[0.28] stroke-1',
  'data-[state=lit]:stroke-accent-violet/70 data-[state=lit]:stroke-[1.5]',
  'data-[state=dim]:stroke-muted-foreground/10',
);

/** The element the stage places at a dot's centre; it has no size of its own. */
export const nodeClass = cn(
  'group/node absolute left-0 top-0',
  'data-[state=dim]:opacity-30',
  'data-[state=neighbour]:z-[5] data-[featured=true]:z-10 data-[state=lit]:z-20',
);

/** The node's link: a 24 px round hit area centred on the dot, bigger than the smallest dots. */
export const nodeLinkClass = cn(
  'group/link absolute left-0 top-0 block size-6 -translate-x-1/2 -translate-y-1/2 rounded-full',
  'focus:outline-none',
);

/** The dot, centred in the link; its size is set inline from the node's degree. */
const dotBaseClass = cn(
  'absolute left-1/2 top-1/2 box-border -translate-x-1/2 -translate-y-1/2 rounded-full',
  // A lit node: a foreground ring at half strength, 5 px out.
  'group-data-[state=lit]/node:outline group-data-[state=lit]/node:outline-offset-[5px]',
  'group-data-[state=lit]/node:outline-foreground/50',
  // The day's concept: a violet halo while it is featured — at rest, or itself lit.
  'group-data-[featured=true]/node:shadow-[0_0_0_4px_rgba(167,139,250,0.22),0_0_14px_3px_rgba(167,139,250,0.5)]',
  // The keyboard's ring, round the dot rather than the hit area.
  'group-focus-visible/link:ring-2 group-focus-visible/link:ring-ring',
  'group-focus-visible/link:ring-offset-2 group-focus-visible/link:ring-offset-surface',
);

/** A concept's filled dot, and an entity's ring. */
export const dotClass = {
  concept: cn(
    dotBaseClass,
    'bg-muted-foreground',
    'group-data-[state=neighbour]/node:bg-accent-violet',
    'group-data-[featured=true]/node:bg-accent-violet',
    'group-data-[state=lit]/node:bg-foreground',
  ),
  entity: cn(
    dotBaseClass,
    'border-[1.5px] border-muted-foreground bg-surface',
    'group-data-[state=neighbour]/node:border-accent-violet',
    'group-data-[featured=true]/node:border-accent-violet',
    'group-data-[state=lit]/node:border-foreground',
  ),
} as const;

/**
 * A node's name, placed by the stage from the dot's centre. Names are drawn over edges with a
 * surface-coloured halo so they stay legible; the featured focus's is larger and bold, the lit
 * node's brighter. Hidden names keep their layout, so they can be measured.
 */
export const nameClass = cn(
  'absolute left-1/2 top-1/2 whitespace-nowrap text-xs leading-4 text-muted-foreground',
  // A halo of stacked surface-coloured shadows: it rings each glyph without touching its fill.
  '[text-shadow:0_0_2px_var(--color-surface),0_0_3px_var(--color-surface),0_0_3px_var(--color-surface)]',
  'data-[shown=false]:invisible',
  'group-data-[state=lit]/node:text-foreground',
  // The lit node's medium weight, bar the featured focus's: lit and featured at once, it stays bold.
  'group-[[data-state=lit]:not([data-featured])]/node:font-medium',
  'group-data-[featured=true]/node:text-[13px] group-data-[featured=true]/node:font-semibold',
  'group-data-[featured=true]/node:text-foreground',
);

/** Where the Fit button sits: over the stage's top-right corner. */
export const fitButtonClass = 'absolute right-2 top-2 bg-surface/80';

/** The line under the stage: the legend at left, the gesture hint at right. */
export const legendRowClass =
  'mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 text-xs text-muted-foreground';

/** One legend entry: its swatch, then its word. */
export const legendItemClass = 'flex items-center gap-1.5';

/** The legend's swatches, drawn like a resting dot of each kind. */
export const legendSwatchClass = {
  concept: 'inline-block size-2 rounded-full bg-muted-foreground',
  entity: 'inline-block size-2 rounded-full border-[1.5px] border-muted-foreground',
} as const;

/** The gesture hint, quieter than the legend. */
export const hintClass = 'text-muted-foreground/70';
