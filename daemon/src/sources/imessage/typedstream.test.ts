import { attributedBodyFor } from './fixtures/typedstream-fixture.ts';
import { decodeAttributedBody } from './typedstream.ts';

function decodedText(bytes: Uint8Array): string | undefined {
  const result = decodeAttributedBody(bytes);
  return 'text' in result ? result.text : undefined;
}

describe('decodeAttributedBody', () => {
  it('reads a short body behind its one-byte length prefix', () => {
    expect(decodedText(attributedBodyFor('Running ten minutes late'))).toBe(
      'Running ten minutes late',
    );
  });

  it('reads a body whose length is written as 0x81 + uint16', () => {
    const long = 'x'.repeat(900);

    expect(decodedText(attributedBodyFor(long, { lengthEncoding: 'uint16' }))).toBe(long);
  });

  it('reads a body whose length is written as 0x82 + uint32', () => {
    const long = 'y'.repeat(70_000);

    expect(decodedText(attributedBodyFor(long, { lengthEncoding: 'uint32' }))).toBe(long);
  });

  it('reads past the extra class name an NSMutableString archive carries', () => {
    expect(decodedText(attributedBodyFor('dictated note', { mutable: true }))).toBe(
      'dictated note',
    );
  });

  it('keeps multi-byte UTF-8 intact — the length prefix counts bytes, not characters', () => {
    expect(decodedText(attributedBodyFor('café ☕️ 完了'))).toBe('café ☕️ 完了');
  });

  it('decodes an empty body as an empty string rather than a failure', () => {
    expect(decodeAttributedBody(attributedBodyFor(''))).toEqual({ text: '' });
  });

  it('fails on bytes that carry no string class marker at all', () => {
    expect(decodeAttributedBody(new Uint8Array([0x04, 0x0b, 0xff, 0x00, 0x42]))).toEqual({
      failed: true,
    });
  });

  it('fails on an empty blob', () => {
    expect(decodeAttributedBody(new Uint8Array())).toEqual({ failed: true });
  });

  it('fails when the length prefix runs past the end of the blob', () => {
    const truncated = attributedBodyFor('short', { overrideLength: 400 });

    expect(decodeAttributedBody(truncated)).toEqual({ failed: true });
  });

  it('fails rather than returning mojibake when the bytes are not valid UTF-8', () => {
    const invalid = attributedBodyFor('', { rawBytes: [0xc3, 0x28, 0xa0, 0xa1] });

    expect(decodeAttributedBody(invalid)).toEqual({ failed: true });
  });
});
