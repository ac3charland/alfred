import { MODULE_ACCENT, activeModule, isCodePath, isCommsPath, isReaderPath } from './modules';

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

  it('resolves the Reader module on its root and everything beneath it', () => {
    expect(activeModule('/reader')).toBe('reader');
    expect(activeModule('/reader/archive')).toBe('reader');
    expect(activeModule('/reader/publications')).toBe('reader');
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
    // `/codex`, `/commspam` and `/readers` are Tasks paths: the prefix has to end at a segment
    // boundary.
    expect(activeModule('/codex')).toBe('tasks');
    expect(activeModule('/commspam')).toBe('tasks');
    expect(activeModule('/readers')).toBe('tasks');
  });
});

describe('isCodePath / isCommsPath / isReaderPath', () => {
  it('agree with activeModule', () => {
    expect(isCodePath('/code/backlog')).toBe(true);
    expect(isCodePath('/comms')).toBe(false);
    expect(isCodePath('/priority')).toBe(false);

    expect(isCommsPath('/comms/people')).toBe(true);
    expect(isCommsPath('/code')).toBe(false);
    expect(isCommsPath('/')).toBe(false);

    expect(isReaderPath('/reader/archive')).toBe(true);
    expect(isReaderPath('/comms')).toBe(false);
    expect(isReaderPath('/')).toBe(false);
  });
});

describe('MODULE_ACCENT', () => {
  it('gives each module its own hue — Tasks amber, Code teal, Comms blue, Reader green', () => {
    expect(MODULE_ACCENT.tasks.text).toBe('text-accent-amber');
    expect(MODULE_ACCENT.code.text).toBe('text-accent-teal');
    expect(MODULE_ACCENT.comms.text).toBe('text-accent-blue');
    expect(MODULE_ACCENT.reader.text).toBe('text-accent-green');
  });

  it('never lets two modules share a hue — the switcher must be readable at a glance', () => {
    const hues = Object.values(MODULE_ACCENT).map((accent) => accent.text);

    // Four modules now (ALF-233); the uniqueness check itself needs no change since it's
    // derived from MODULE_ACCENT's own keys, but pin the count so a module silently reusing
    // another's hue can't slip through by accident.
    expect(hues).toHaveLength(4);
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
    expect(MODULE_ACCENT.reader).toEqual({
      text: 'text-accent-green',
      ring: 'ring-accent-green',
      dot: 'bg-accent-green',
      border: 'border-accent-green',
      glow: 'glow-green',
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
