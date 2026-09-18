import { PAUSED_CARD, PUBLICATION_CARD } from './publications.styles';

describe('publications card styles', () => {
  it('is a bordered surface card', () => {
    expect(PUBLICATION_CARD).toContain('rounded-xl');
    expect(PUBLICATION_CARD).toContain('border-border');
    expect(PUBLICATION_CARD).toContain('bg-surface');
  });

  it('dims a paused card', () => {
    expect(PAUSED_CARD).toBe('opacity-55');
  });
});
