/**
 * Links into the wiki repo on GitHub, on `main` — where the reading room sends everything the
 * snapshot does not hold: raw citations, source folders, the repo's own index and any other
 * in-repo file. The snapshot only ever holds `main`, so a link to `main` is a link to the version
 * of the file the page was compiled against (or its successor).
 */

const GITHUB = 'https://github.com';
const BRANCH = 'main';

/** `path` without leading or trailing slashes, so a folder written `raw/x/` joins cleanly. */
function trimSlashes(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function withPath(base: string, path: string): string {
  const trimmed = trimSlashes(path);
  return trimmed === '' ? base : `${base}/${trimmed}`;
}

/** The file at `path` in `repo` (`owner/name`), with `anchor` (with or without its `#`) kept. */
export function githubBlobUrl(repo: string, path: string, anchor = ''): string {
  const fragment = anchor.replace(/^#/, '');
  const url = withPath(`${GITHUB}/${repo}/blob/${BRANCH}`, path);
  return fragment === '' ? url : `${url}#${fragment}`;
}

/** The folder at `path` in `repo` (`owner/name`); an empty path is the repo root. */
export function githubTreeUrl(repo: string, path: string): string {
  return withPath(`${GITHUB}/${repo}/tree/${BRANCH}`, path);
}
