import { type WikiFetch, blobsQuery, fetchWikiBlobs, fetchWikiTree } from './graphql';

const env = { GITHUB_TOKEN: 'pat-123', WIKI_REPO: 'ac3charland/knowledge' };
const WIRE_NULL: unknown = JSON.parse('null');
const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(64);

/** A fetch that answers every call with `body`. */
function answering(body: unknown): jest.Mock<ReturnType<WikiFetch>, Parameters<WikiFetch>> {
  return jest.fn<ReturnType<WikiFetch>, Parameters<WikiFetch>>(() =>
    Promise.resolve(Response.json(body)),
  );
}

describe('blobsQuery', () => {
  it('aliases one object(oid:) per blob, in order', () => {
    const query = blobsQuery([OID_A, OID_B]);
    expect(query).toContain(
      `p0: object(oid: "${OID_A}") { ... on Blob { text isBinary isTruncated } }`,
    );
    expect(query).toContain(
      `p1: object(oid: "${OID_B}") { ... on Blob { text isBinary isTruncated } }`,
    );
  });

  it('refuses anything that is not a git object id, since it is inlined into the query', () => {
    expect(() => blobsQuery(['abc") { x } #'])).toThrow('not a git object id');
    expect(() => blobsQuery(['A'.repeat(40)])).toThrow('not a git object id');
  });
});

describe('fetchWikiTree', () => {
  it('refuses a WIKI_REPO that is not owner/name before spending a request', async () => {
    const doFetch = answering({});
    await expect(fetchWikiTree({ ...env, WIKI_REPO: 'knowledge' }, doFetch)).rejects.toThrow(
      'WIKI_REPO is not owner/name',
    );
    await expect(fetchWikiTree({ ...env, WIKI_REPO: 'a/b/c' }, doFetch)).rejects.toThrow(
      'WIKI_REPO is not owner/name',
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('throws on a response with no data and no errors', async () => {
    await expect(fetchWikiTree(env, answering({ data: WIRE_NULL }))).rejects.toThrow('no data');
  });

  it('throws when an error-free response is missing a section alias, rather than reading it empty', async () => {
    await expect(
      fetchWikiTree(
        env,
        answering({
          data: { repository: { ref: { target: { oid: OID_A } }, concepts: WIRE_NULL } },
        }),
      ),
    ).rejects.toThrow('no entities section');
  });

  it('treats an empty errors array as no errors', async () => {
    const tree = await fetchWikiTree(
      env,
      answering({
        data: {
          repository: {
            ref: { target: { oid: OID_A } },
            concepts: WIRE_NULL,
            entities: WIRE_NULL,
            sources: WIRE_NULL,
            questions: WIRE_NULL,
          },
        },
        errors: [],
      }),
    );
    expect(tree).toEqual({ commitOid: OID_A, entries: [] });
  });
});

describe('fetchWikiBlobs', () => {
  it('returns each blob in the order asked, a null text read as absent', async () => {
    const blobs = await fetchWikiBlobs(
      env,
      answering({
        data: {
          repository: {
            p1: { text: WIRE_NULL, isBinary: true, isTruncated: false },
            p0: { text: '# A', isBinary: false, isTruncated: false },
          },
        },
      }),
      [OID_A, OID_B],
    );
    expect(blobs).toEqual([
      { text: '# A', isBinary: false, isTruncated: false },
      { text: undefined, isBinary: true, isTruncated: false },
    ]);
  });

  it('throws when an asked-for blob came back null, rather than storing a hole', async () => {
    await expect(
      fetchWikiBlobs(env, answering({ data: { repository: { p0: WIRE_NULL } } }), [OID_A]),
    ).rejects.toThrow(`no blob ${OID_A}`);
  });
});
