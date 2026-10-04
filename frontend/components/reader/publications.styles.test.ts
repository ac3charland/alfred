import {
  KIND_CHIP,
  PAUSED_CARD,
  PUBLICATION_CAPTION,
  PUBLICATION_CARD,
} from './publications.styles';

describe('publications card styles', () => {
  it('is a bordered surface card', () => {
    expect(PUBLICATION_CARD).toContain('rounded-xl');
    expect(PUBLICATION_CARD).toContain('border-border');
    expect(PUBLICATION_CARD).toContain('bg-surface');
  });

  it('dims a paused card', () => {
    expect(PAUSED_CARD).toBe('opacity-55');
  });

  it('is a small-caps caption', () => {
    expect(PUBLICATION_CAPTION).toContain('uppercase');
    expect(PUBLICATION_CAPTION).toContain('text-xs');
  });

  it('greens the kind chip only while its picker is open', () => {
    expect(KIND_CHIP).toContain('data-[state=open]:text-accent-green');
    expect(KIND_CHIP).not.toMatch(/(^| )text-accent-green/);
  });
});
