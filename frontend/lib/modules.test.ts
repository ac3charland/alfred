import { MODULE_ACCENT, activeModule, isCodePath, isCommsPath } from './modules';

describe('activeModule', () => {
  it('resolves the Code module on its root and everything beneath it', () => {
    expect(activeModule('/code')).toBe('code');
    expect(activeModule('/code/backlog')).toBe('code');
    expect(activeModule('/code/abc-123')).toBe('code');
  });

  it('resolves the Comms module on its root and everything beneath it', () => {
    expect(activeModule('/comms')).toBe('comms');
    expect(activeModule('/comms/people')).toBe('comms');
    expect(activeModule('/comms/rubric')).toBe('comms');
    expect(activeModule('/comms/examples')).toBe('comms');
  });

  it('falls back to Tasks for the root and every cross-cutting view', () => {
    expect(activeModule('/')).toBe('tasks');
    expect(activeModule('/priority')).toBe('tasks');
    expect(activeModule('/today')).toBe('tasks');
    expect(activeModule('/folders/f1')).toBe('tasks');
    expect(activeModule('/completed')).toBe('tasks');
    expect(activeModule('/habits')).toBe('tasks');
  });

  it('does not claim a path that merely starts with a module name', () => {
    // `/codex` and `/commspam` are Tasks paths: the prefix has to end at a segment boundary.
    expect(activeModule('/codex')).toBe('tasks');
    expect(activeModule('/commspam')).toBe('tasks');
  });
});

describe('isCodePath / isCommsPath', () => {
  it('agree with activeModule', () => {
    expect(isCodePath('/code/backlog')).toBe(true);
    expect(isCodePath('/comms')).toBe(false);
    expect(isCodePath('/priority')).toBe(false);

    expect(isCommsPath('/comms/people')).toBe(true);
    expect(isCommsPath('/code')).toBe(false);
    expect(isCommsPath('/')).toBe(false);
  });
});

describe('MODULE_ACCENT', () => {
  it('gives each module its own hue — Tasks amber, Code teal, Comms blue', () => {
    expect(MODULE_ACCENT.tasks.text).toBe('text-accent-amber');
    expect(MODULE_ACCENT.code.text).toBe('text-accent-teal');
    expect(MODULE_ACCENT.comms.text).toBe('text-accent-blue');
  });

  it('never lets two modules share a hue — the switcher must be readable at a glance', () => {
    const hues = Object.values(MODULE_ACCENT).map((accent) => accent.text);

    expect(new Set(hues).size).toBe(hues.length);
  });

  it("keeps every field of a module accent on that module's one hue", () => {
    expect(MODULE_ACCENT.tasks).toEqual({
      text: 'text-accent-amber',
      ring: 'ring-accent-amber',
      dot: 'bg-accent-amber',
      border: 'border-accent-amber',
      glow: 'glow-amber',
    });
  });

  it('spells every class out in full so the Tailwind scanner can see it', () => {
    for (const accent of Object.values(MODULE_ACCENT)) {
      expect(accent.text).toMatch(/^text-accent-[a-z]+$/);
      expect(accent.ring).toMatch(/^ring-accent-[a-z]+$/);
      expect(accent.dot).toMatch(/^bg-accent-[a-z]+$/);
      expect(accent.border).toMatch(/^border-accent-[a-z]+$/);
      expect(accent.glow).toMatch(/^glow-[a-z]+$/);
    }
  });
});
