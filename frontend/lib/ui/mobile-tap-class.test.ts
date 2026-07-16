import { mobileTapClass } from './mobile-tap-class';

describe('mobileTapClass', () => {
  it('expands the hit area via an invisible overlay, removed at md+', () => {
    expect(mobileTapClass).toContain('relative');
    expect(mobileTapClass).toContain('after:absolute');
    expect(mobileTapClass).toContain('after:-inset-3');
    expect(mobileTapClass).toContain('md:after:hidden');
  });
});
