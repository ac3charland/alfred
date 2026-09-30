import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

interface HookCommand {
  type: string;
  timeout: number;
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
interface Settings {
  enabledPlugins: Record<string, boolean>;
  hooks: { SessionStart: HookGroup[]; Stop: HookGroup[] };
}

const settings = JSON.parse(
  readFileSync(path.join(REPO_ROOT, '.claude/settings.json'), 'utf8'),
) as Settings;

/** The one command a hook event registers, with the script it runs. */
function only(groups: HookGroup[]): { group: HookGroup; hook: HookCommand; script: string } {
  expect(groups).toHaveLength(1);
  const [group] = groups;
  expect(group?.hooks).toHaveLength(1);
  const [hook] = group?.hooks ?? [];
  if (group === undefined || hook === undefined) throw new Error('expected exactly one hook');
  const script = /"\$CLAUDE_PROJECT_DIR\/([^"]+)"/.exec(hook.command)?.[1];
  expect(script).toBeDefined();
  return { group, hook, script: path.join(REPO_ROOT, script ?? '') };
}

describe('.claude/settings.json hooks', () => {
  it('runs the hook CLI at session start, only on a fresh startup', () => {
    const { group, hook, script } = only(settings.hooks.SessionStart);
    expect(group.matcher).toBe('startup');
    expect(hook.type).toBe('command');
    expect(hook.timeout).toBe(10);
    expect(hook.command).toMatch(/^NODE_USE_ENV_PROXY=1 node "/);
    expect(hook.command).toMatch(/ session-start$/);
    expect(existsSync(script)).toBe(true);
  });

  it('runs the hook CLI when a turn stops', () => {
    const { group, hook, script } = only(settings.hooks.Stop);
    expect(group.matcher).toBeUndefined();
    expect(hook.type).toBe('command');
    expect(hook.timeout).toBe(15);
    expect(hook.command).toMatch(/^NODE_USE_ENV_PROXY=1 node "/);
    expect(hook.command).toMatch(/ stop$/);
    expect(existsSync(script)).toBe(true);
  });

  it('points both events at the same CLI', () => {
    expect(only(settings.hooks.SessionStart).script).toBe(only(settings.hooks.Stop).script);
    expect(only(settings.hooks.Stop).script).toBe(
      path.join(REPO_ROOT, 'tools/session-ledger/src/hook/cli.ts'),
    );
  });

  it('keeps the plugins the file already enabled', () => {
    expect(settings.enabledPlugins).toEqual({ 'frontend-design@claude-plugins-official': true });
  });
});
