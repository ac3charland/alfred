/**
 * How the story detail renders: the centred `dialog` card on a wide screen, or the full-screen
 * `sheet` on a phone (below `md`). One body component takes it as a prop rather than being two
 * component trees, so the two can't drift on behaviour.
 */
export type DetailLayout = 'dialog' | 'sheet';

/**
 * A section heading's classes per layout. The desktop card keeps its small grey capitals; the
 * sheet has room and need for a clearer hierarchy — title, section, body — so its headings are
 * 14px semibold foreground in sentence case, which outranks the muted breadcrumb and hints.
 */
export const SECTION_HEADING_CLASS: Record<DetailLayout, string> = {
  dialog: 'text-xs font-semibold uppercase tracking-wide text-muted-foreground',
  sheet: 'text-sm font-semibold normal-case tracking-normal text-foreground',
};
