import { dropZoneActiveClass, dropZoneBaseClass } from './folder-drop-zone.styles';

describe('folder-drop-zone styles', () => {
  it('base zone styling is a rounded surface with a colour transition', () => {
    expect(dropZoneBaseClass).toContain('rounded-sm');
    expect(dropZoneBaseClass).toContain('transition-colors');
    expect(dropZoneBaseClass).toContain('motion-reduce:transition-none');
  });

  it('active (hovered) styling adds the teal wash + ring', () => {
    expect(dropZoneActiveClass).toContain('bg-accent-teal/15');
    expect(dropZoneActiveClass).toContain('ring-accent-teal/50');
  });
});
