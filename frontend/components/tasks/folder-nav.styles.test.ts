import {
  folderActionsClass,
  folderDragHandleClass,
  folderIconClass,
  folderRowClass,
} from './folder-nav.styles';

describe('folderRowClass', () => {
  it('is the hover group the handle and actions reveal on', () => {
    expect(folderRowClass).toContain('group/folder');
  });

  it('positions the row so the absolute reorder gaps anchor to it', () => {
    expect(folderRowClass).toContain('relative');
  });
});

describe('folderActionsClass', () => {
  it('stays visible below md, where there is no hover to reveal it', () => {
    expect(folderActionsClass).toContain('opacity-100');
  });

  it('hides until the row is hovered at md+', () => {
    expect(folderActionsClass).toContain('md:motion-safe:opacity-0');
    expect(folderActionsClass).toContain('md:motion-safe:group-hover/folder:opacity-100');
  });

  it('keeps the actions visible under reduced motion at every width (the hide is motion-safe)', () => {
    expect(folderActionsClass).not.toContain('md:opacity-0');
  });
});

describe('folderDragHandleClass', () => {
  it('is desktop-only — touch reorders through the row menu instead', () => {
    expect(folderDragHandleClass).toContain('hidden');
    expect(folderDragHandleClass).toContain('md:block');
  });

  it('sits over the folder icon rather than adding a gutter that shifts the row', () => {
    expect(folderDragHandleClass).toContain('absolute');
    expect(folderDragHandleClass).toContain('left-3');
  });

  it('reveals on row hover and reads as draggable', () => {
    expect(folderDragHandleClass).toContain('opacity-0');
    expect(folderDragHandleClass).toContain('group-hover/folder:opacity-100');
    expect(folderDragHandleClass).toContain('cursor-grab');
  });
});

describe('folderIconClass', () => {
  it('fades out at md+ so the drag handle can take its place on hover', () => {
    expect(folderIconClass).toContain('md:group-hover/folder:opacity-0');
  });
});
