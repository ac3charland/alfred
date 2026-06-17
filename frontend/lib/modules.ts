/**
 * The single active-module derivation, shared by everything that must agree on which
 * module a URL belongs to: the shell's module router, the shell nav, and the Tasks ⇄ Code
 * switcher. Keeping one rule here is what guarantees URL, main content, sidebar, and switcher
 * highlight never disagree mid-switch (see ALF-27).
 *
 * Code owns `/code` and everything beneath it; every other path is Tasks (inbox, a folder,
 * completed).
 */
export function isCodePath(pathname: string): boolean {
  return pathname === '/code' || pathname.startsWith('/code/');
}
