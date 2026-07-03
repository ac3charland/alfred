import { bulkBarClass, bulkBarWrapperClass } from './inbox-bulk-bar.styles';

describe('inbox bulk bar styles', () => {
  it('pins the bar to the bottom of the viewport as a centred floating layer', () => {
    expect(bulkBarWrapperClass).toContain('fixed');
    expect(bulkBarWrapperClass).toContain('bottom-0');
    expect(bulkBarWrapperClass).toContain('justify-center');
    // Floats above page content, below dialogs (z-50) and toasts (z-[60]).
    expect(bulkBarWrapperClass).toContain('z-40');
  });

  it('keeps the surrounding gutter click-through, only the pill itself catching pointer events', () => {
    expect(bulkBarWrapperClass).toContain('pointer-events-none');
    expect(bulkBarClass).toContain('pointer-events-auto');
  });

  it('offsets past the desktop sidebar so the pill centres under the content, not the viewport', () => {
    expect(bulkBarWrapperClass).toContain('md:pl-56');
  });

  it('re-skins the pill as a raised teal-bordered surface, no longer an in-flow block', () => {
    expect(bulkBarClass).toContain('bg-surface/95');
    expect(bulkBarClass).toContain('border-accent-teal');
    expect(bulkBarClass).toContain('shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]');
    // The old in-flow top margin must be gone — a fixed layer reserves no flow space itself.
    expect(bulkBarClass).not.toContain('mt-3');
  });
});
