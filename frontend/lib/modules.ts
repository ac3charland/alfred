/**
 * The single active-module derivation, shared by everything that must agree on which
 * module a URL belongs to: the shell's module router, the shell nav, the mobile drawer, and
 * the module switcher. Keeping one rule here is what guarantees URL, main content, sidebar,
 * and switcher highlight never disagree mid-switch (ALF-27).
 *
 * There are three modules now, so module resolution is a real router rather than a boolean:
 * Code owns `/code` and everything beneath it, Comms owns `/comms` and everything beneath it,
 * and every other path is Tasks (inbox, a folder, completed, the cross-cutting views).
 */

/** The three top-level modules the shell can be showing. */
export type ModuleId = 'tasks' | 'code' | 'comms';

/** True when `pathname` is the module's root or lives beneath it. */
function ownsPath(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * Which module a URL belongs to. Tasks is the fallback rather than a prefix match, because it
 * owns the app's root and every cross-cutting view hanging off it.
 */
export function activeModule(pathname: string): ModuleId {
  if (ownsPath(pathname, '/code')) return 'code';
  if (ownsPath(pathname, '/comms')) return 'comms';
  return 'tasks';
}

/** True on the Code module's own routes. A thin wrapper over {@link activeModule}. */
export function isCodePath(pathname: string): boolean {
  return activeModule(pathname) === 'code';
}

/** True on the Comms module's own routes. A thin wrapper over {@link activeModule}. */
export function isCommsPath(pathname: string): boolean {
  return activeModule(pathname) === 'comms';
}

/** The accent utility classes one module wears. Every field is a complete class string. */
export interface ModuleAccent {
  /** Text colour — the active switcher segment, a view heading's glyph. */
  text: string;
  /** Focus/selection ring colour. */
  ring: string;
  /** A filled indicator dot. */
  dot: string;
  /** Border colour for a chip or card edge. */
  border: string;
  /** The ambient glow utility (see the `glow-*` utilities in globals.css). */
  glow: string;
}

/**
 * Each module's accent, written out as STATIC full class strings — never interpolated from the
 * colour name. Tailwind v4 scans source text for complete utility names, so a built-up string
 * like `` `text-accent-${colour}` `` compiles to nothing at all. (Same rule the per-project
 * colour tables follow.)
 *
 * Tasks and Code have always shared the app's teal; Comms is blue, the accent the product spec
 * reserved for the communication firewall.
 */
export const MODULE_ACCENT: Record<ModuleId, ModuleAccent> = {
  tasks: {
    text: 'text-accent-teal',
    ring: 'ring-accent-teal',
    dot: 'bg-accent-teal',
    border: 'border-accent-teal',
    glow: 'glow-teal',
  },
  code: {
    text: 'text-accent-teal',
    ring: 'ring-accent-teal',
    dot: 'bg-accent-teal',
    border: 'border-accent-teal',
    glow: 'glow-teal',
  },
  comms: {
    text: 'text-accent-blue',
    ring: 'ring-accent-blue',
    dot: 'bg-accent-blue',
    border: 'border-accent-blue',
    glow: 'glow-blue',
  },
};
