import { isInteractiveTarget } from './pointer-sensor';

describe('isInteractiveTarget', () => {
  it('returns false for a null target', () => {
    expect(isInteractiveTarget(null)).toBe(false);
  });

  it('returns false for a plain, non-interactive element', () => {
    const div = document.createElement('div');
    expect(isInteractiveTarget(div)).toBe(false);
  });

  it('returns true for a button', () => {
    const button = document.createElement('button');
    expect(isInteractiveTarget(button)).toBe(true);
  });

  it('returns true for an input', () => {
    const input = document.createElement('input');
    expect(isInteractiveTarget(input)).toBe(true);
  });

  it('returns true for a textarea', () => {
    expect(isInteractiveTarget(document.createElement('textarea'))).toBe(true);
  });

  it('returns true for an element nested inside a button (e.g. the icon svg)', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.append(icon);
    expect(isInteractiveTarget(icon)).toBe(true);
  });

  it('returns true for an element with role="menuitem"', () => {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    expect(isInteractiveTarget(item)).toBe(true);
  });

  it('returns false for non-Element event targets', () => {
    expect(isInteractiveTarget(new EventTarget())).toBe(false);
  });
});
