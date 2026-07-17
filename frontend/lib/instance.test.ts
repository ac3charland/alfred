import { getInstanceConfig } from './instance';

/**
 * `getInstanceConfig` reads the four `NEXT_PUBLIC_INSTANCE_*` vars. Jest does not inline them,
 * so we drive each permutation by mutating `process.env` around a saved snapshot.
 */
describe('getInstanceConfig', () => {
  const KEYS = [
    'NEXT_PUBLIC_INSTANCE_LABEL',
    'NEXT_PUBLIC_INSTANCE_ACCENT',
    'NEXT_PUBLIC_OTHER_INSTANCE_LABEL',
    'NEXT_PUBLIC_OTHER_INSTANCE_URL',
  ] as const;

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });

  it('reads all vars into a fully-populated config', () => {
    process.env.NEXT_PUBLIC_INSTANCE_LABEL = 'Personal';
    process.env.NEXT_PUBLIC_INSTANCE_ACCENT = 'teal';
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_LABEL = 'Work';
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_URL = 'https://work.alfred.app';

    expect(getInstanceConfig()).toEqual({
      label: 'Personal',
      accent: 'teal',
      other: { label: 'Work', url: 'https://work.alfred.app' },
    });
  });

  it('reads the Work instance with the amber accent', () => {
    process.env.NEXT_PUBLIC_INSTANCE_LABEL = 'Work';
    process.env.NEXT_PUBLIC_INSTANCE_ACCENT = 'amber';
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_LABEL = 'Personal';
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_URL = 'https://personal.alfred.app';

    expect(getInstanceConfig()).toMatchObject({ label: 'Work', accent: 'amber' });
  });

  it('returns other=null when the other-instance URL is unset (single deployment / local dev)', () => {
    process.env.NEXT_PUBLIC_INSTANCE_LABEL = 'Personal';
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_LABEL = 'Work';
    // No NEXT_PUBLIC_OTHER_INSTANCE_URL.

    expect(getInstanceConfig().other).toBeNull();
  });

  it('treats a blank other-instance URL as unset', () => {
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_URL = ' '.repeat(3);

    expect(getInstanceConfig().other).toBeNull();
  });

  it('defaults the label to "alfred" when unset', () => {
    expect(getInstanceConfig().label).toBe('alfred');
  });

  it('defaults the accent to "teal" when unset', () => {
    expect(getInstanceConfig().accent).toBe('teal');
  });

  it('falls back to the default accent when the value is not a known token', () => {
    process.env.NEXT_PUBLIC_INSTANCE_ACCENT = 'chartreuse';

    expect(getInstanceConfig().accent).toBe('teal');
  });

  it('defaults the other label to "Other" when its URL is set but its label is not', () => {
    process.env.NEXT_PUBLIC_OTHER_INSTANCE_URL = 'https://work.alfred.app';

    expect(getInstanceConfig().other).toEqual({ label: 'Other', url: 'https://work.alfred.app' });
  });
});
