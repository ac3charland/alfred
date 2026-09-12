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
  it('gives every module its own colour — Tasks yellow, Code teal, Comms blue', () => {
    expect(MODULE_ACCENT.tasks.text).toBe('text-accent-amber');
    expect(MODULE_ACCENT.code.text).toBe('text-accent-teal');
    expect(MODULE_ACCENT.comms.text).toBe('text-accent-blue');
  });

  it('leaves no two modules sharing an accent', () => {
    const texts = Object.values(MODULE_ACCENT).map((accent) => accent.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('keeps each module internally consistent — one colour across text, ring, dot, border, glow', () => {
    for (const accent of Object.values(MODULE_ACCENT)) {
      const colour = accent.text.replace('text-accent-', '');
      expect(accent.ring).toBe(`ring-accent-${colour}`);
      expect(accent.dot).toBe(`bg-accent-${colour}`);
      expect(accent.border).toBe(`border-accent-${colour}`);
      expect(accent.glow).toBe(`glow-${colour}`);
    }
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
