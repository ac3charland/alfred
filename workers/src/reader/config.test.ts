import { READER_DEFAULT_DAILY_CAP, readReaderConfig } from './config';

describe('readReaderConfig', () => {
  it('parses the model and a positive-integer ceiling', () => {
    expect(readReaderConfig({ READER_MODEL: 'claude-sonnet-5', READER_DAILY_CAP: '30' })).toEqual({
      ok: true,
      config: { model: 'claude-sonnet-5', dailyCap: 30 },
    });
  });

  it('defaults the ceiling when the var is absent', () => {
    expect(readReaderConfig({ READER_MODEL: 'claude-sonnet-5' })).toEqual({
      ok: true,
      config: { model: 'claude-sonnet-5', dailyCap: READER_DEFAULT_DAILY_CAP },
    });
  });

  it('fails closed on a missing or blank model', () => {
    expect(readReaderConfig({})).toEqual({ ok: false, error: 'READER_MODEL is not set' });
    expect(readReaderConfig({ READER_MODEL: '  ' })).toEqual({
      ok: false,
      error: 'READER_MODEL is not set',
    });
  });

  it.each(['0', '-1', '3.5', 'thirty', '', '1e3', '0x10'])(
    'fails closed on a ceiling that is not a positive integer (%j) rather than reading it as unlimited',
    (raw) => {
      const result = readReaderConfig({ READER_MODEL: 'claude-sonnet-5', READER_DAILY_CAP: raw });
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty('error', expect.stringContaining('READER_DAILY_CAP'));
    },
  );
});
