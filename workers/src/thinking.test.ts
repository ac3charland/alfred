import { thinkingOff } from './thinking';

describe('thinkingOff', () => {
  it('spells "off" as between_tools on Sonnet 5.5, which rejects disabled with a 400', () => {
    expect(thinkingOff('claude-sonnet-5-5')).toEqual({ type: 'between_tools' });
  });

  it.each(['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'])(
    'spells "off" as disabled on %s, which rejects between_tools',
    (model) => {
      expect(thinkingOff(model)).toEqual({ type: 'disabled' });
    },
  );
});
