import {
  cardChromeClass,
  checkboxIncompleteClass,
  checkboxSizeClass,
  chevronButtonClass,
  chevronIconClass,
  collapseClass,
  confirmTitleClass,
  deleteCollapseClass,
  deleteFadeClass,
  dropPlusClass,
  metaFooterClass,
  mobileTapClass,
  rowActionsClass,
  rowBaseClass,
  rowDropTargetClass,
  rowHoverClass,
  subtaskCountBadgeClass,
  subtreeClass,
  taskListContainerClass,
  titleInputClass,
  titleTextClass,
} from './task-row.styles';

describe('task-row styles', () => {
  it('collapse wrapper animates the grid-rows track with the delayed timing', () => {
    expect(collapseClass).toContain('grid');
    expect(collapseClass).toContain('transition-[grid-template-rows]');
    expect(collapseClass).toContain('delay-200');
    expect(collapseClass).toContain('motion-reduce:transition-none');
  });

  it('delete collapse animates the grid-rows track WITHOUT the completion delay', () => {
    expect(deleteCollapseClass).toContain('grid');
    expect(deleteCollapseClass).toContain('transition-[grid-template-rows]');
    expect(deleteCollapseClass).toContain('motion-reduce:transition-none');
    // No checkbox pop to hold the collapse behind, so it starts immediately.
    expect(deleteCollapseClass).not.toContain('delay-200');
  });

  it('delete fade transitions opacity and is disabled under reduced motion', () => {
    expect(deleteFadeClass).toContain('transition-opacity');
    expect(deleteFadeClass).toContain('motion-reduce:transition-none');
  });

  it('row base is a flex layout with a colour transition', () => {
    expect(rowBaseClass).toContain('flex');
    expect(rowBaseClass).toContain('items-start');
    expect(rowBaseClass).toContain('rounded-sm');
    expect(rowBaseClass).toContain('transition-colors');
  });

  it('row wraps into head + footer lines on mobile, single line at md+', () => {
    // Mobile: the badges footer can wrap below the head; md+ restores today's single line.
    expect(rowBaseClass).toContain('flex-wrap');
    expect(rowBaseClass).toContain('md:flex-nowrap');
  });

  it('depth-0 card chrome is a mobile-only rounded surface panel', () => {
    expect(cardChromeClass).toContain('rounded-2xl');
    expect(cardChromeClass).toContain('border');
    expect(cardChromeClass).toContain('bg-surface');
    // md+ dissolves the card so the rows fall back into the shared divide-y list.
    expect(cardChromeClass).toContain('md:rounded-none');
    expect(cardChromeClass).toContain('md:border-0');
    expect(cardChromeClass).toContain('md:bg-transparent');
  });

  it('meta footer wraps the badges below the title on mobile, contents at md+', () => {
    // basis-full + order-last pushes the badge cluster onto its own full-width line, indented
    // under the title column.
    expect(metaFooterClass).toContain('basis-full');
    expect(metaFooterClass).toContain('order-last');
    expect(metaFooterClass).toContain('pl-[3.75rem]');
    // display:contents dissolves the wrapper at md+, so the badges are inline row children again.
    expect(metaFooterClass).toContain('md:contents');
  });

  it('mobile card subtree is hairline-set-off + hairline-separated, flush at md+', () => {
    expect(subtreeClass).toContain('border-t');
    expect(subtreeClass).toContain('divide-y');
    expect(subtreeClass).toContain('md:border-t-0');
    expect(subtreeClass).toContain('md:divide-y-0');
  });

  it('mobile tap class expands the hit area via an overlay, removed at md+', () => {
    expect(mobileTapClass).toContain('relative');
    expect(mobileTapClass).toContain('after:absolute');
    expect(mobileTapClass).toContain('after:-inset-3');
    expect(mobileTapClass).toContain('md:after:hidden');
  });

  it('actions ride the head line on mobile, reset at md+', () => {
    expect(rowActionsClass).toContain('order-3');
    expect(rowActionsClass).toContain('md:order-none');
  });

  it('list container is a gapped card column on mobile, one divided panel at md+', () => {
    expect(taskListContainerClass).toContain('flex');
    expect(taskListContainerClass).toContain('gap-2');
    expect(taskListContainerClass).toContain('md:block');
    expect(taskListContainerClass).toContain('md:divide-y');
    expect(taskListContainerClass).toContain('md:rounded-2xl');
  });

  it('subtask-count pill keeps its dense tinted styling in a named class', () => {
    expect(subtaskCountBadgeClass).toContain('bg-[#1b2438]');
    expect(subtaskCountBadgeClass).toContain('text-[13px]');
  });

  it('drop-target highlight is the teal wash + ring; the default is a hover wash', () => {
    expect(rowDropTargetClass).toContain('bg-accent-teal/15');
    expect(rowDropTargetClass).toContain('ring-accent-teal/50');
    expect(rowHoverClass).toContain('hover:bg-secondary/30');
  });

  it('chevron button stays put and the icon rotates with a transition', () => {
    expect(chevronButtonClass).toContain('shrink-0');
    expect(chevronIconClass).toContain('transition-transform');
    expect(chevronIconClass).toContain('duration-150');
  });

  it('drop "+" placeholder is a teal-filled checkbox-sized square', () => {
    expect(dropPlusClass).toContain('h-4');
    expect(dropPlusClass).toContain('border-accent-teal');
    expect(dropPlusClass).toContain('bg-accent-teal');
    expect(dropPlusClass).toContain('text-background');
  });

  it('checkbox sizing and the incomplete border/hover treatment', () => {
    // Enlarged to a 24px visual box on mobile, back to today's 16px at md+.
    expect(checkboxSizeClass).toContain('h-6');
    expect(checkboxSizeClass).toContain('w-6');
    expect(checkboxSizeClass).toContain('md:h-4');
    expect(checkboxSizeClass).toContain('md:w-4');
    expect(checkboxIncompleteClass).toContain('border-border');
    expect(checkboxIncompleteClass).toContain('hover:border-accent-teal');
  });

  it('inline title input and its confirm checkbox', () => {
    expect(titleInputClass).toContain('flex-1');
    expect(titleInputClass).toContain('min-w-0');
    expect(titleInputClass).toContain('py-0.5');
    expect(confirmTitleClass).toContain('h-5');
    expect(confirmTitleClass).toContain('border-accent-teal');
    expect(confirmTitleClass).toContain('bg-accent-teal');
  });

  it('row actions are always visible on mobile, hover-revealed on md+ pointer devices (ALF-88)', () => {
    // Touch/mobile has no hover, so the actions ship visible by default (below md).
    expect(rowActionsClass).toContain('opacity-100');
    // On md+ pointer devices they hide until the row is hovered, then fade in. The hide is
    // gated on motion-safe so reduced-motion users keep them visible at every width.
    expect(rowActionsClass).toContain('md:motion-safe:opacity-0');
    expect(rowActionsClass).toContain('md:motion-safe:group-hover/row:opacity-100');
    // The reveal fades, and the fade is cut under reduced motion.
    expect(rowActionsClass).toContain('transition-opacity');
    expect(rowActionsClass).toContain('motion-reduce:transition-none');
    // The base state is NOT the old hover-only hide (which was unreachable on touch).
    expect(rowActionsClass).not.toContain('opacity-0 group-hover/row:opacity-100');
  });

  it('title text wraps (break-words) and fades with a delayed colour transition', () => {
    expect(titleTextClass).toContain('break-words');
    expect(titleTextClass).toContain('transition-colors');
    expect(titleTextClass).toContain('delay-200');
    expect(titleTextClass).not.toContain('truncate');
  });

  it('title is text-base on mobile, text-sm at md+', () => {
    expect(titleTextClass).toContain('text-base');
    expect(titleTextClass).toContain('md:text-sm');
  });
});
