import {
  addSubtaskButtonClass,
  captureRevealClass,
  cardChromeClass,
  checkboxIncompleteClass,
  checkboxSizeClass,
  chevronButtonClass,
  chevronIconClass,
  classificationMarkClass,
  classificationMarkGlyphClass,
  classifiedFlashClass,
  collapseClass,
  collapseInnerClass,
  confirmTitleClass,
  deleteCollapseClass,
  deleteFadeClass,
  dispatchReadyPipClass,
  dropPlusClass,
  metaFooterClass,
  mobileTapClass,
  notesPreviewClass,
  rowActionsClass,
  rowBaseClass,
  rowContentColClass,
  rowDropTargetClass,
  rowHoverClass,
  sendOffClass,
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

  it('collapse inner grid item can shrink below its content so the notes preview truncates', () => {
    // The grid item's automatic minimum is min-content; min-w-0 lets it shrink below the
    // nowrap notes width so the card stays viewport-bounded and the preview ellipsizes (ALF-99).
    expect(collapseInnerClass).toContain('min-w-0');
  });

  it('notes preview clips to a single line with an ellipsis', () => {
    expect(notesPreviewClass).toContain('truncate');
  });

  it('delete fade transitions opacity and is disabled under reduced motion', () => {
    expect(deleteFadeClass).toContain('transition-opacity');
    expect(deleteFadeClass).toContain('motion-reduce:transition-none');
  });

  it("send-off is the capture ghost's own slide-out, disabled under reduced motion", () => {
    // The shared `--animate-send-off` token — the SAME motion the capture box gives a
    // just-captured thought, so a dispatched row leaves exactly as a new one arrived.
    expect(sendOffClass).toContain('animate-send-off');
    expect(sendOffClass).toContain('motion-reduce:animate-none');
  });

  it('row base is a flex layout with a colour transition', () => {
    expect(rowBaseClass).toContain('flex');
    expect(rowBaseClass).toContain('rounded-sm');
    expect(rowBaseClass).toContain('transition-colors');
  });

  it('leading controls + actions centre against the whole card on mobile, top-align at md+', () => {
    // Mobile: the checkbox / chevron / actions centre against the full title+meta column
    // (see rowContentColClass) so they sit in the card's vertical centre, not the title's
    // first line.
    expect(rowBaseClass).toContain('items-center');
    // md+ reverts to top-alignment for today's single-line desktop rows.
    expect(rowBaseClass).toContain('md:items-start');
  });

  it('row is a single non-wrapping line — title+meta stack inside their own column', () => {
    // The badges no longer wrap onto a sibling row line; they stack inside rowContentColClass,
    // so the row itself never wraps (there's no flex-wrap to toggle at md+).
    expect(rowBaseClass).not.toContain('flex-wrap');
    expect(rowBaseClass).not.toContain('md:flex-nowrap');
  });

  it('content column stacks title over meta on mobile, dissolves to inline at md+', () => {
    // Mobile: flex-1 column so a long title + its badges own the row width and give the
    // controls a full-height block to centre against.
    expect(rowContentColClass).toContain('flex-1');
    expect(rowContentColClass).toContain('flex-col');
    // md+ display:contents dissolves the column so title + badges are direct row children again.
    expect(rowContentColClass).toContain('md:contents');
  });

  it('depth-0 card chrome is a mobile-only rounded surface panel with halved padding', () => {
    expect(cardChromeClass).toContain('rounded-2xl');
    expect(cardChromeClass).toContain('border');
    expect(cardChromeClass).toContain('bg-surface');
    // Padding is the compact p-1 (half of the former p-2) so the mobile card hugs its rows.
    expect(cardChromeClass).toContain('p-1');
    expect(cardChromeClass).not.toContain('p-2');
    // md+ dissolves the card so the rows fall back into the shared divide-y list.
    expect(cardChromeClass).toContain('md:rounded-none');
    expect(cardChromeClass).toContain('md:border-0');
    expect(cardChromeClass).toContain('md:bg-transparent');
  });

  it('meta footer is a wrapping badge line that dissolves to inline at md+', () => {
    // The badges sit on their own line beneath the title inside the shared content column, so
    // the footer no longer needs its own basis-full / order / indent — that's the column's job.
    expect(metaFooterClass).toContain('flex-wrap');
    expect(metaFooterClass).not.toContain('basis-full');
    expect(metaFooterClass).not.toContain('order-last');
    // display:contents dissolves the wrapper at md+, so the badges are inline row children again.
    expect(metaFooterClass).toContain('md:contents');
  });

  it('capture reveal pads both axes so the field focus ring is not clipped', () => {
    // The teal focus ring reaches ~3px past the field's border box; the reveal's
    // overflow-hidden height clip shaves the left edge unless the inner layer has horizontal
    // room. px-1 (4px) clears it, py-1 keeps the existing vertical room. Shared by the row's
    // add-subtask box and the folder header's capture box — one class, both reveals.
    expect(captureRevealClass).toContain('px-1');
    expect(captureRevealClass).toContain('py-1');
  });

  it('add-subtask "+" is hidden on mobile, inline at md+ (collapsed into the ⋯ menu — ALF-118)', () => {
    // On mobile the "+" is dropped entirely (its affordance moves into the dot menu); md+ brings
    // it back as an inline-flex button beside the menu.
    expect(addSubtaskButtonClass).toContain('hidden');
    expect(addSubtaskButtonClass).toContain('md:inline-flex');
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
    // A mid-grey border (not the near-invisible `border` token) so the empty box has contrast.
    expect(checkboxIncompleteClass).toContain('border-muted-foreground/50');
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

  it('provenance mark sits inline with the title and never shrinks', () => {
    // Inline so it travels with the title text; shrink-0 so the select-mode row's truncating
    // title can't squeeze it out.
    expect(classificationMarkClass).toContain('inline-flex');
    expect(classificationMarkClass).toContain('shrink-0');
    expect(classificationMarkClass).toContain('items-center');
  });

  it('provenance glyph is 11px in three weights of the same muted grey', () => {
    for (const glyphClass of Object.values(classificationMarkGlyphClass)) {
      expect(glyphClass).toContain('h-[11px]');
      expect(glyphClass).toContain('w-[11px]');
      // Monochrome: no accent colour, which the row's palette has already spent five times over.
      expect(glyphClass).not.toContain('accent-');
    }
    // The classifier's mark is the loudest, the unjudged row's the faintest.
    expect(classificationMarkGlyphClass.model).toContain('text-muted-foreground/95');
    expect(classificationMarkGlyphClass.claimed).toContain('text-muted-foreground/65');
    expect(classificationMarkGlyphClass.unjudged).toContain('text-muted-foreground/40');
  });

  it('dispatch-ready pip is a small filled accent-green dot, never shrunk', () => {
    expect(dispatchReadyPipClass).toContain('h-1.5');
    expect(dispatchReadyPipClass).toContain('w-1.5');
    expect(dispatchReadyPipClass).toContain('rounded-full');
    expect(dispatchReadyPipClass).toContain('bg-accent-green/80');
    expect(dispatchReadyPipClass).toContain('shrink-0');
    // No pill: no border, no padding, no text — just the dot.
    expect(dispatchReadyPipClass).not.toContain('border');
    expect(dispatchReadyPipClass).not.toContain('px-');
  });

  it('dispatch-ready pip centres itself on the row line, whatever the ancestor aligns to', () => {
    // The ordinary row top-aligns its dissolved metadata children (md:items-start); a bare 6px
    // dot needs its own self-center to land on the badges' visual middle instead of their top.
    expect(dispatchReadyPipClass).toContain('self-center');
  });

  it('just-classified ring is a hairline grey ring, quieter than the search jump’s', () => {
    expect(classifiedFlashClass).toContain('ring-1');
    expect(classifiedFlashClass).toContain('ring-inset');
    // Grey, the provenance mark's own register — the row's five accents are all spoken for.
    expect(classifiedFlashClass).toContain('ring-muted-foreground/50');
    expect(classifiedFlashClass).not.toContain('accent-');
  });

  it('title is a compact, tight-leading size on mobile, text-sm at md+', () => {
    // A slightly-shrunk 15px with snug leading so long wrapped titles stay compact on a phone.
    expect(titleTextClass).toContain('text-[15px]');
    expect(titleTextClass).toContain('leading-snug');
    // md+ restores today's text-sm and its native line-height (desktop unchanged).
    expect(titleTextClass).toContain('md:text-sm');
    expect(titleTextClass).toContain('md:leading-5');
  });
});
