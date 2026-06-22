import {
  checkboxIncompleteClass,
  checkboxSizeClass,
  chevronButtonClass,
  chevronIconClass,
  collapseClass,
  confirmTitleClass,
  dropPlusClass,
  rowBaseClass,
  rowDropTargetClass,
  rowHoverClass,
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

  it('row base is a flex layout with a colour transition', () => {
    expect(rowBaseClass).toContain('flex');
    expect(rowBaseClass).toContain('items-start');
    expect(rowBaseClass).toContain('rounded-sm');
    expect(rowBaseClass).toContain('transition-colors');
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
    expect(checkboxSizeClass).toContain('h-4');
    expect(checkboxSizeClass).toContain('w-4');
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

  it('title text wraps (break-words) and fades with a delayed colour transition', () => {
    expect(titleTextClass).toContain('break-words');
    expect(titleTextClass).toContain('transition-colors');
    expect(titleTextClass).toContain('delay-200');
    expect(titleTextClass).not.toContain('truncate');
  });
});
