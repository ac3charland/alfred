import { captureSurfaceClass, captureTextareaClass } from './capture-box.styles';

describe('capture-box styles', () => {
  it('surface is a rounded, bordered card that lifts on focus-within', () => {
    expect(captureSurfaceClass).toContain('rounded-2xl');
    expect(captureSurfaceClass).toContain('bg-surface');
    expect(captureSurfaceClass).toContain('transition-[box-shadow,border-color]');
    expect(captureSurfaceClass).toContain('focus-within:border-accent-teal');
  });

  it('textarea is transparent with the serif-prompt padding', () => {
    expect(captureTextareaClass).toContain('bg-transparent');
    expect(captureTextareaClass).toContain('pb-12');
    expect(captureTextareaClass).toContain('text-base');
  });
});
