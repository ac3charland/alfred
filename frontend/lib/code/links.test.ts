import type { CodeStory, Project } from '@/lib/types';

import {
  buildBypassUrl,
  buildImplementationUrl,
  buildRefinementUrl,
  promptFromLaunchUrl,
} from './links';

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
    priority: 1,
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

  it('instructs a spec-only artifact (no implementation) without hardcoding the spec path', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/spec/i);
    expect(prompt).toMatch(/no implementation|do not implement|not.*implement/i);
    // The path/format is the refinement skill's job now — the prompt must NOT bake in a concrete
    // spec location, so an OpenSpec (multi-file folder) project isn't forced to a single .html.
    expect(prompt).not.toContain('docs/specs/ALF-42.html');
  });

  it('defers the spec format/structure to the refinement skill, not the prompt', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // The HTML-plan + section-skeleton mandate moved INTO the skill; the prompt no longer bakes
    // a format convention, so each project's skill can choose its own (HTML, OpenSpec, …).
    expect(prompt).not.toMatch(/NOT a markdown file/i);
    expect(prompt).not.toMatch(/SVG diagram/i);
    expect(prompt).toMatch(/following the refinement skill/i);
    expect(prompt).toMatch(/it defines this repo's spec format/i);
  });

  it('names HTML only as the no-skill fallback format', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // When the skill is absent there is no convention to follow, so the prompt falls back to a
    // self-contained HTML doc — a sensible default, but only as the fallback.
    expect(prompt).toMatch(/if the skill is absent/i);
    expect(prompt).toMatch(/self-contained HTML/i);
  });

  it('points at the refinement skill dropped into each repo', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('.claude/skills/refinement/SKILL.md');
  });

  it('embeds the alfred block with ticket + refinement phase and a fill-in spec-path', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('```alfred');
    expect(prompt).toContain('alfred-ticket: ALF-42');
    expect(prompt).toContain('phase: refinement');
    // spec-path is a placeholder the agent fills with the spec's real path, not a baked location.
    expect(prompt).toContain('spec-path: <path-or-folder-of-the-spec>');
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

  it('no longer inlines the alfred section skeleton (it moved to the skill)', () => {
    const prompt = parse(buildRefinementUrl(makeProject(), makeStory())).prompt ?? '';
    // The Title/Context/Proposed-change/Acceptance-criteria/Out-of-scope skeleton is an
    // alfred-specific spec convention — it lives in the refinement skill now, not the prompt,
    // so a project with its own skill isn't forced into alfred's section layout.
    expect(prompt).not.toContain('Out of scope');
    expect(prompt).not.toContain('Proposed change');
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
    // No hardcoded spec path — only the ticket ref threads through to the alfred block.
    expect(prompt).not.toContain('docs/specs/RLP-7');
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

  it('instructs archiving the consumed spec to docs/specs/archive/<REF>', () => {
    const prompt =
      parse(
        buildImplementationUrl(makeProject(), makeStory({ spec_path: 'docs/specs/ALF-42.html' })),
      ).prompt ?? '';
    // The spec is scaffolding — the implementation PR git-moves it out of the active dir.
    expect(prompt).toMatch(/archive/i);
    expect(prompt).toContain('docs/specs/archive/ALF-42.html');
  });

  it('keeps the block spec-path on the ORIGINAL active path, not the archive path', () => {
    // The CI check derives the archive location from the recorded spec-path, so the block must
    // still name the active path even though the file has been moved.
    const prompt =
      parse(
        buildImplementationUrl(makeProject(), makeStory({ spec_path: 'docs/specs/ALF-42.html' })),
      ).prompt ?? '';
    expect(prompt).toContain('spec-path: docs/specs/ALF-42.html');
  });

  it('derives the archive path from the spec basename for a non-default ref/extension', () => {
    const prompt =
      parse(buildImplementationUrl(makeProject(), makeStory({ spec_path: 'docs/specs/RLP-7.md' })))
        .prompt ?? '';
    expect(prompt).toContain('docs/specs/archive/RLP-7.md');
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

  it('points at the implement-spec skill for the build-from-a-spec conventions', () => {
    const prompt = parse(buildImplementationUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toContain('.claude/skills/implement-spec/SKILL.md');
  });

  it('references the spec format-agnostically (no baked HTML/open-in-a-browser assumption)', () => {
    const prompt = parse(buildImplementationUrl(makeProject(), makeStory())).prompt ?? '';
    // The spec may be HTML, markdown, or an OpenSpec folder — the refinement skill chose; the
    // implementation prompt must not assume a single rendered HTML file.
    expect(prompt).not.toMatch(/self-contained HTML plan/i);
    expect(prompt).not.toMatch(/open it in a browser/i);
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

  it('does NOT instruct archiving a spec (skip-refinement produces none to archive)', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).not.toMatch(/archive/i);
  });

  it('tells Claude to open one PR carrying the block', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/open.*(pull request|pr)/i);
    expect(prompt).toMatch(/verbatim|reproduced exactly/i);
  });

  it('does NOT point at the implement-spec skill (skip-refinement builds no spec to consume)', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    // ALF-75: the implement-spec skill owns spec-consuming conventions (archiving a consumed
    // spec); a skip-refinement session has no spec, so pointing at it only invited never-read
    // spec files. The prompt now leans on the repo's own conventions instead.
    expect(prompt).not.toContain('.claude/skills/implement-spec/SKILL.md');
  });

  it('does NOT carry a spec-path in the alfred block (no spec to name)', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    // ALF-75: there is no committed spec, so the block must not name one — a spec-path line only
    // implied a file that never exists. CI requires spec-path on refinement PRs only, so an
    // implementation/bypass block is valid without it.
    expect(prompt).not.toMatch(/spec-path:/i);
  });

  it('still keeps the TDD nudge to pin each requirement with a test', () => {
    const prompt = parse(buildBypassUrl(makeProject(), makeStory())).prompt ?? '';
    expect(prompt).toMatch(/tests\/TDD|pin each requirement with a test/i);
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

describe('promptFromLaunchUrl', () => {
  it('round-trips the exact (decoded) prompt a builder embedded in `q`', () => {
    const story = makeStory();
    const url = buildRefinementUrl(makeProject(), story);
    // What the link would prefill IS what we hand to the clipboard fallback — byte-for-byte.
    expect(promptFromLaunchUrl(url)).toBe(parse(url).prompt);
    expect(promptFromLaunchUrl(url)).toContain('ALF-42: Verify the GitHub webhook HMAC signature');
  });

  it('returns an empty string when the URL carries no `q`', () => {
    expect(promptFromLaunchUrl('https://claude.ai/code?repo=ac3charland/alfred')).toBe('');
  });
});
