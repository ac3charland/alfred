import { cascadeContentClass } from './cascade-modal.styles';

describe('cascade-modal styles', () => {
  it('centres a bordered modal card on the surface', () => {
    expect(cascadeContentClass).toContain('fixed');
    expect(cascadeContentClass).toContain('-translate-x-1/2');
    expect(cascadeContentClass).toContain('max-w-md');
    expect(cascadeContentClass).toContain('rounded-2xl');
    expect(cascadeContentClass).toContain('bg-surface');
  });

  it('wires the open/close enter+exit animation with a reduced-motion opt-out', () => {
    expect(cascadeContentClass).toContain('data-[state=open]:animate-in');
    expect(cascadeContentClass).toContain('data-[state=closed]:animate-out');
    expect(cascadeContentClass).toContain('data-[state=open]:fade-in-0');
    expect(cascadeContentClass).toContain('data-[state=open]:zoom-in-95');
    expect(cascadeContentClass).toContain('motion-reduce:animate-none');
  });

  it('includes the teal glow shadow', () => {
    expect(cascadeContentClass).toContain('shadow-[0_0_40px_0_rgba(79,209,224,0.08)]');
  });
});
