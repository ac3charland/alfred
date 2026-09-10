import {
  UnparseableAppleDateError,
  appleDateToIso,
  appleNanoseconds,
  normalizeHandle,
} from './normalize.ts';

describe('normalizeHandle', () => {
  it('turns a formatted US number into E.164', () => {
    expect(normalizeHandle('(312) 555-0100')).toBe('+13125550100');
  });

  it('keeps an international number, dropping its spaces', () => {
    expect(normalizeHandle('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('lower-cases an email address', () => {
    expect(normalizeHandle('Dana@Example.com')).toBe('dana@example.com');
  });

  it('reads an eleven-digit number that already starts with the US country code', () => {
    expect(normalizeHandle('1-312-555-0100')).toBe('+13125550100');
  });

  it('leaves a short code alone rather than inventing a country for it', () => {
    expect(normalizeHandle('262966')).toBe('262966');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeHandle('  +13125550100 ')).toBe('+13125550100');
  });

  it('has nothing to say about an absent or empty handle', () => {
    expect(normalizeHandle()).toBeUndefined();
    expect(normalizeHandle(' '.repeat(3))).toBeUndefined();
  });
});

describe('appleDateToIso', () => {
  it('reads the nanosecond dates current macOS writes', () => {
    expect(appleDateToIso(720_000_000_000_000_000n)).toBe('2023-10-26T08:00:00.000Z');
  });

  it('reads the second-resolution dates older chat.db files carry', () => {
    expect(appleDateToIso(430_000_000n)).toBe('2014-08-17T20:26:40.000Z');
  });

  it('anchors on 2001-01-01, not the Unix epoch', () => {
    expect(appleDateToIso(0n)).toBe('2001-01-01T00:00:00.000Z');
  });

  // A hand-restored or iCloud-glitched chat.db can carry a message.date so far from 2001 that no
  // JS Date can represent it at all. Left unguarded, `new Date(...).toISOString()` throws the
  // native `RangeError: Invalid time value`, naming neither the row nor the value that caused it —
  // see node -e "console.log(new Date(-99999999999999*1000 + 978307200000).toISOString())".
  it('rejects a raw value so far out of range that no JS Date can represent it, by a named error rather than the opaque native one', () => {
    expect(() => appleDateToIso(-99_999_999_999_999n)).toThrow(UnparseableAppleDateError);
    expect(() => appleDateToIso(-99_999_999_999_999n)).toThrow(/-99999999999999/);
  });

  it('still accepts a huge-but-representable nanosecond value, so the guard is a real range check', () => {
    // Comfortably inside Date's actual limit (±8.64e15 ms from the Unix epoch — about 273,790
    // years) but still an enormous nanosecond count, to prove this isn't an accidental rejection
    // of every large-magnitude value.
    const millisecondsFromUnixEpoch = 8_000_000_000_000_000;
    const millisecondsFromAppleEpoch = millisecondsFromUnixEpoch - 978_307_200_000;
    const raw = BigInt(millisecondsFromAppleEpoch) * 1_000_000n;

    expect(() => appleDateToIso(raw)).not.toThrow();
  });
});

describe('appleNanoseconds', () => {
  it('converts a wall-clock instant into the units chat.db compares against', () => {
    expect(appleNanoseconds(new Date('2023-10-26T08:00:00.000Z'))).toBe(720_000_000_000_000_000n);
  });
});
