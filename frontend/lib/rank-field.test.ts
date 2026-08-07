import { rankField } from './rank-field';

describe('rankField', () => {
  it('scores a prefix match 0', () => {
    expect(rankField('alf', 'Alfred')).toBe(0);
  });

  it('scores a substring match 1', () => {
    expect(rankField('fred', 'Alfred')).toBe(1);
  });

  it('returns null when the field does not contain the query', () => {
    expect(rankField('zzz', 'Alfred')).toBeNull();
  });

  it('lowercases the field so an uppercase key matches a lowercase query', () => {
    expect(rankField('alf', 'ALF')).toBe(0);
  });

  it('scores an empty query as a prefix match on anything', () => {
    expect(rankField('', 'Alfred')).toBe(0);
  });
});
