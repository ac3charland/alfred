import { assertNever } from './assert-never';

describe('assertNever', () => {
  it('throws with the context label and the serialized value', () => {
    const value = { type: 'mystery' };
    expect(() => assertNever(value as never, 'test action')).toThrow(
      'Unhandled test action: {"type":"mystery"}',
    );
  });

  it('serializes the offending value into the message', () => {
    expect(() => assertNever('oops' as never, 'widget')).toThrow('Unhandled widget: "oops"');
  });
});
