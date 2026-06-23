import { playToastSound } from './play-toast-sound';

describe('playToastSound', () => {
  const originalAudioContext = globalThis.AudioContext;

  afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
  });

  it('no-ops without throwing when AudioContext is unavailable', () => {
    // jsdom has no AudioContext; emulate the SSR / old-browser case explicitly.
    // @ts-expect-error — deleting a DOM global for the unavailable-AudioContext path.
    delete globalThis.AudioContext;

    expect(() => {
      playToastSound();
    }).not.toThrow();
  });

  it('builds and starts an oscillator when AudioContext is available', () => {
    const oscillator = {
      type: 'sine',
      frequency: { setValueAtTime: jest.fn() },
      connect: jest.fn(() => gain),
      start: jest.fn(),
      stop: jest.fn(),
      onended: null as (() => void) | null,
    };
    const gain = {
      gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      connect: jest.fn(),
    };
    const ctx = {
      currentTime: 0,
      destination: {},
      createOscillator: jest.fn(() => oscillator),
      createGain: jest.fn(() => gain),
      close: jest.fn(),
    };
    const AudioContextMock = jest.fn(() => ctx);
    globalThis.AudioContext = AudioContextMock as unknown as typeof AudioContext;

    playToastSound();

    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('swallows errors thrown while building the chime', () => {
    const AudioContextMock = jest.fn(() => {
      throw new Error('boom');
    });
    globalThis.AudioContext = AudioContextMock;

    expect(() => {
      playToastSound();
    }).not.toThrow();
  });
});
