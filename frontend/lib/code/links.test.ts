import type { CodeStory, Project } from '@/lib/types';

import { buildBypassUrl, buildImplementationUrl, buildRefinementUrl } from './links';

/**
 * A project row, mirroring what the code store seeds. `repo_owner`/`repo_name` are what the
 * link builders draw from for the `repo` param — the URL is derived entirely from stored data.
 */
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 5,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
    factory_state: 'needs_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: 'Verify the GitHub webhook HMAC signature',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Communication Firewall',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    ...overrides,
  };
}

/** Parse a built link into its origin/path + the decoded `repo`/`prompt` params. */
function parse(url: string): { base: string; repo: string | null; prompt: string | null } {
  const parsed = new URL(url);
  return {
    base: `${parsed.origin}${parsed.pathname}`,
    repo: parsed.searchParams.get('repo'),
    prompt: parsed.searchParams.get('q'),
  };
}

describe('buildRefinementUrl', () => {
  it('targets claude.ai/code with the project repo as owner/name', () => {
    const url = buildRefinementUrl(makeProject(), makeStory());
    const { base, repo } = parse(url);
    expect(base).toBe('https://claude.ai/code');
    expect(repo).toBe('ac3charland/alfred');
  });

  it('derives the repo param entirely from the project row, not the story', () => {
    const url = buildRefinementUrl(
      makeProject({ repo_owner: 'octocat', repo_name: 'hello-world' }),
      makeStory({ repo_owner: 'stale', repo_name: 'stale' }),
    );
    expect(parse(url).repo).toBe('octocat/hello-world');
  });

  it('leads the prompt with the ref and title so the browser tab is scannable', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // The very first line is "ALF-42: <title>" — nothing precedes it.
    const firstLine = prompt.split('\n', 1)[0];
    expect(firstLine).toBe('ALF-42: Verify the GitHub webhook HMAC signature');
  });

  it('instructs a spec-only artifact (no implementation) saved to docs/specs/<REF>.html', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/spec/i);
    expect(prompt).toMatch(/no implementation|do not implement|not.*implement/i);
    expect(prompt).toContain('docs/specs/ALF-42.html');
  });

  it('directs the agent to author the spec as a self-contained HTML plan', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // The whole point of this change: the produced spec is a rich HTML document, not markdown.
    expect(prompt).toMatch(/self-contained HTML plan/i);
    expect(prompt).toMatch(/NOT a markdown file/i);
    expect(prompt).toMatch(/SVG diagram/i);
  });

  it('points at the refinement skill dropped into each repo', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('.claude/skills/refinement/SKILL.md');
  });

  it('embeds the alfred frontmatter block with ticket, refinement phase, and spec-path', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('```alfred');
    expect(prompt).toContain('alfred-ticket: ALF-42');
    expect(prompt).toContain('phase: refinement');
    expect(prompt).toContain('spec-path: docs/specs/ALF-42.html');
  });

  it('tells Claude to open a PR carrying that block', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/open.*(pull request|pr)/i);
  });

  it('gates on context: ask the human before writing when the ticket is thin', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // The clarification gate is the headline guardrail — a smaller model must be told to ask
    // rather than invent scope. It must reference asking before the spec is written.
    expect(prompt).toMatch(/ask me here/i);
    expect(prompt).toMatch(/before writing the spec/i);
  });

  it('tells Claude to ground itself in the repo and its own conventions first', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/skim the repo/i);
    expect(prompt).toMatch(/CONTRIBUTING|CLAUDE\.md/);
  });

  it('carries a self-contained section skeleton for the no-guide fallback', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // When the refinement skill is absent the prompt must still define the spec shape, so
    // "OpenSpec-style" is no longer an undefined term the model has to guess at.
    expect(prompt).toContain('Acceptance criteria');
    expect(prompt).toContain('Out of scope');
  });

  it('asks Claude to self-check the saved spec and verbatim block before the PR', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/verbatim|reproduced exactly/i);
  });

  it('flags truncated notes so partial context is not mistaken for the whole', () => {
    const prompt =
      parse(buildRefinementUrl(makeProject(), makeStory({ notes: 'Z'.repeat(2000) }))).prompt ?? '';
    expect(prompt).toMatch(/truncated/i);
  });

  it('does NOT inline the full notes/spec body (length cap) — references the file', () => {
    const longNotes = 'X'.repeat(20_000);
    const url = buildRefinementUrl(makeProject(), makeStory({ notes: longNotes }));
    // The whole URL stays well under the desktop ~14k cap; the giant notes are not inlined.
    expect(url.length).toBeLessThan(14_000);
    expect(parse(url).prompt ?? '').not.toContain(longNotes);
  });

  it('includes the short title/notes context safe to inline', () => {
    const prompt =
      parse(buildRefinementUrl(makeProject(), makeStory({ notes: 'Use HMAC-SHA256' }))).prompt ??
      '';
    expect(prompt).toContain('Use HMAC-SHA256');
  });

  it('url-encodes the prompt so spaces and newlines survive the query string', () => {
    const url = buildRefinementUrl(makeProject(), makeStory());
    // The raw query string must be percent-encoded (no raw spaces/newlines/backticks).
    const rawQuery = url.split('?', 2)[1] ?? '';
    expect(rawQuery).not.toMatch(/[ \n`]/);
    // Round-trips back to the readable prompt.
    expect(parse(url).prompt).toContain('ALF-42: Verify the GitHub webhook HMAC signature');
  });

  it('handles a different ref/title/repo combination correctly', () => {
    const url = buildRefinementUrl(
      makeProject({ repo_owner: 'me', repo_name: 'relay', key: 'RLP' }),
      makeStory({ ref: 'RLP-7', title: 'Add the digest scheduler' }),
    );
    const { repo, prompt } = parse(url);
    expect(repo).toBe('me/relay');
    expect((prompt ?? '').split('\n', 1)[0]).toBe('RLP-7: Add the digest scheduler');
    expect(prompt).toContain('docs/specs/RLP-7.html');
    expect(prompt).toContain('alfred-ticket: RLP-7');
  });
});

describe('buildImplementationUrl', () => {
  it('targets claude.ai/code with the project repo as owner/name', () => {
    const url = buildImplementationUrl(makeProject(), makeStory());
    const { base, repo } = parse(url);
    expect(base).toBe('https://claude.ai/code');
    expect(repo).toBe('ac3charland/alfred');
  });

  it('leads the prompt with the ref and title (scannable tab)', () => {
    const prompt = parse(buildImplementationUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt.split('\n', 1)[0]).toBe('ALF-42: Verify the GitHub webhook HMAC signature');
  });

  it('instructs implementing the merged spec at the story spec_path', () => {
    const prompt =
      parse(
        buildImplementationUrl(makeProject(), makeStory({ spec_path: 'docs/specs/ALF-42.html' })),
      ).prompt ?? '';
    expect(prompt).toMatch(/implement/i);
    expect(prompt).toContain('docs/specs/ALF-42.html');
  });

  it('falls back to the conventional docs/specs/<REF>.html path when spec_path is null', () => {
    // spec_path is normally set by the refinement-merge webhook before ready_for_dev, but be
    // defensive: a null path still yields the conventional location so the link is usable.
    const prompt =
      parse(buildImplementationUrl(makeProject(), makeStory({ spec_path: null }))).prompt ?? '';
    expect(prompt).toContain('docs/specs/ALF-42.html');
  });

  it('embeds the alfred frontmatter block with the implementation phase', () => {
    const prompt = parse(buildImplementationUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('```alfred');
    expect(prompt).toContain('alfred-ticket: ALF-42');
    expect(prompt).toContain('phase: implementation');
  });

  it('does NOT inline the spec markdown body (references the committed file)', () => {
    const longSpec = 'Y'.repeat(20_000);
    const url = buildImplementationUrl(
      makeProject(),
      makeStory({ spec_markdown: longSpec, spec_path: 'docs/specs/ALF-42.html' }),
    );
    expect(url.length).toBeLessThan(14_000);
    expect(parse(url).prompt ?? '').not.toContain(longSpec);
  });

  it('tells Claude to open a PR carrying the block', () => {
    const prompt = parse(buildImplementationUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/open.*(pull request|pr)/i);
  });

  it('url-encodes the prompt', () => {
    const rawQuery = buildImplementationUrl(makeProject(), makeStory()).split('?', 2)[1] ?? '';
    expect(rawQuery).not.toMatch(/[ \n`]/);
  });

  it('carries the shared guardrails: ground in the repo and ask when the spec is ambiguous', () => {
    const prompt = parse(buildImplementationUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/skim the repo/i);
    expect(prompt).toMatch(/CONTRIBUTING|CLAUDE\.md/);
    // The implementation analog of the clarification gate: don't guess past a stale/ambiguous spec.
    expect(prompt).toMatch(/ask me here/i);
    expect(prompt).toMatch(/verbatim|reproduced exactly/i);
  });
});

describe('buildBypassUrl', () => {
  it('targets claude.ai/code with the project repo as owner/name', () => {
    const url = buildBypassUrl(makeProject(), makeStory());
    const { base, repo } = parse(url);
    expect(base).toBe('https://claude.ai/code');
    expect(repo).toBe('ac3charland/alfred');
  });

  it('leads the prompt with the ref and title (scannable tab)', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt.split('\n', 1)[0]).toBe('ALF-42: Verify the GitHub webhook HMAC signature');
  });

  it('carries the clarification gate: ground in the repo and ask before building when scope is unclear', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/skim the repo/i);
    expect(prompt).toMatch(/CONTRIBUTING|CLAUDE\.md/);
    expect(prompt).toMatch(/ask me here/i);
  });

  it('instructs implementing directly once the plan is settled', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/implement/i);
    expect(prompt).toMatch(/settled/i);
  });

  it('does NOT tell the agent to read a committed spec (there is none)', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    // No "read the spec / implement the merged spec at <path>" instruction, unlike the
    // implementation prompt. The skip-refinement flow produces no spec file at all.
    expect(prompt).not.toMatch(/read the (committed |merged )?spec/i);
    expect(prompt).not.toMatch(/merged spec/i);
    expect(prompt).toMatch(/no committed spec to read/i);
  });

  it('embeds the alfred frontmatter block with the implementation phase (so the Worker advances it)', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('```alfred');
    expect(prompt).toContain('alfred-ticket: ALF-42');
    expect(prompt).toContain('phase: implementation');
  });

  it('tells Claude to open one PR carrying the block', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/open.*(pull request|pr)/i);
    expect(prompt).toMatch(/verbatim|reproduced exactly/i);
  });

  it('flags truncated notes so partial context is not mistaken for the whole', () => {
    const prompt =
      parse(buildBypassUrl(makeProject(), makeStory({ notes: 'Z'.repeat(2000) }))).prompt ?? '';
    expect(prompt).toMatch(/truncated/i);
  });

  it('does NOT inline a long notes body (length cap)', () => {
    const longNotes = 'X'.repeat(20_000);
    const url = buildBypassUrl(makeProject(), makeStory({ notes: longNotes }));
    expect(url.length).toBeLessThan(14_000);
    expect(parse(url).prompt ?? '').not.toContain(longNotes);
  });

  it('url-encodes the prompt', () => {
    const rawQuery = buildBypassUrl(makeProject(), makeStory()).split('?', 2)[1] ?? '';
    expect(rawQuery).not.toMatch(/[ \n`]/);
  });
});
