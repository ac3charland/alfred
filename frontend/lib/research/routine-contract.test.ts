/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fireResearchRoutine } from './routine';

jest.mock('server-only', () => ({}));

/**
 * The research Routine runs outside this repo's code: its saved prompt (pasted by hand from
 * `routines/research/PROMPT.md`) parses the fire's text, and the skill it follows PUTs the report
 * back to the delivery route. Nothing type-checks that seam, so these tests pin both ends to the
 * code that is on the other side of it.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PROMPT = readFileSync(path.join(REPO_ROOT, 'routines/research/PROMPT.md'), 'utf8');
const SKILL = readFileSync(path.join(REPO_ROOT, 'routines/research/SKILL.md'), 'utf8');

/** The post-id pattern the saved prompt tells the session to validate against. */
function promptIdPattern(): RegExp {
  const match = /(\^\[0-9a-f\]\{8\}-\S+\$)/.exec(PROMPT);
  if (match?.[1] === undefined) throw new Error('PROMPT.md names no post-id pattern');
  return new RegExp(match[1]);
}

describe('the research Routine contract', () => {
  it('points the saved prompt at a skill that exists', () => {
    expect(PROMPT).toContain('Follow routines/research/SKILL.md');
    expect(existsSync(path.join(REPO_ROOT, 'routines/research/SKILL.md'))).toBe(true);
  });

  it('fires text in exactly the shape the saved prompt parses', async () => {
    const id = crypto.randomUUID();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await fireResearchRoutine(
      { fireUrl: 'https://routine.test/fire', fireToken: 't', deliveryKey: 'k' },
      { id, research_brief: 'Is it worth it?\n\nNotes.' },
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    const { text } = JSON.parse(typeof body === 'string' ? body : '{}') as { text: string };
    const [firstLine, separator, ...brief] = text.split('\n');

    // "a first line post_id=<id>, a line containing only ---, then the brief"
    expect(PROMPT).toContain('a first line post_id=<id>, a line');
    expect(firstLine).toBe(`post_id=${id}`);
    expect(separator).toBe('---');
    expect(brief.join('\n')).toBe('Is it worth it?\n\nNotes.');
    expect(promptIdPattern().test(id)).toBe(true);
  });

  it('validates the post id strictly, so a payload cannot smuggle a path', () => {
    const pattern = promptIdPattern();
    expect(pattern.test('../../api/items')).toBe(false);
    expect(pattern.test(`${crypto.randomUUID()}/retry`)).toBe(false);
    expect(pattern.test(crypto.randomUUID().toUpperCase())).toBe(false);
  });

  it('delivers to the route that accepts the report, without an Authorization header', () => {
    expect(SKILL).toContain('"$ALFRED_URL/api/reader/research/<post_id>"');
    expect(SKILL).toContain('-X PUT');
    expect(SKILL).toContain("jq -Rs '{report: .}'");
    expect(SKILL).not.toMatch(/-H ['"]?Authorization/);
    expect(existsSync(path.join(REPO_ROOT, 'frontend/app/api/reader/research/[id]/route.ts'))).toBe(
      true,
    );
  });
});
