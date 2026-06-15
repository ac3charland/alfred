import { type GithubEnv, fetchSpec } from './github';

const env: GithubEnv = { GITHUB_TOKEN: 'pat-123' };

/** Base64-encode UTF-8 text with Web-standard primitives (no Node Buffer in the Workers runtime). */
function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = [...bytes].map((byte) => String.fromCodePoint(byte)).join('');
  return btoa(binary);
}

/** Encode like the GitHub Contents API: base64 with a newline every 60 chars. */
function githubBase64(text: string): string {
  const b64 = toBase64Utf8(text);
  return (b64.match(/.{1,60}/g) ?? []).join('\n') + '\n';
}

function mockFetch(response: Response): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

describe('fetchSpec', () => {
  it('fetches, decodes the base64 spec, and returns markdown + sha', async () => {
    const markdown = '# ALF-42 — Spec\n\nUnicode: café — déjà vu. ✅';
    const spy = mockFetch(
      Response.json(
        { content: githubBase64(markdown), encoding: 'base64', sha: 'blobsha123' },
        { status: 200 },
      ),
    );

    const result = await fetchSpec(env, 'ac3charland', 'alfred', 'specs/ALF-42.md', 'mergesha');

    expect(result).toEqual({ markdown, sha: 'blobsha123' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.github.com/repos/ac3charland/alfred/contents/specs/ALF-42.md?ref=mergesha',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer pat-123');
    expect(headers['User-Agent']).toBe('alfred-software-factory');
  });

  it('returns undefined when the file is missing (non-2xx)', async () => {
    mockFetch(new Response('Not Found', { status: 404 }));
    await expect(
      fetchSpec(env, 'ac3charland', 'alfred', 'specs/ALF-99.md', 'sha'),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the encoding is not base64', async () => {
    mockFetch(Response.json({ content: '', encoding: 'none', sha: 'x' }, { status: 200 }));
    await expect(
      fetchSpec(env, 'ac3charland', 'alfred', 'specs/ALF-42.md', 'sha'),
    ).resolves.toBeUndefined();
  });
});
