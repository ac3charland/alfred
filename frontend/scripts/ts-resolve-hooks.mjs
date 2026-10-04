import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * An ESM resolve hook that lets a dev script import the frontend's own modules.
 *
 * Node runs a `.ts` file directly by stripping its types, which is what makes a one-off script
 * possible without a build step — but stripping types adds no module resolver. The app's source
 * is written for a bundler, so an internal import is either aliased (`@/lib/sort`) or
 * extensionless, and Node's resolver refuses both: it looks for a package called `@/lib` or a
 * file called exactly `sort`, and reports ERR_MODULE_NOT_FOUND from inside a module the script
 * never named.
 *
 * So the hook fills those two gaps and nothing else: `@/` becomes the package root, and a
 * specifier that does not resolve is retried as `.ts`. The alternative is a build step for a
 * script whose whole point is to be run once by hand, or a second copy of the module it needs.
 *
 * `server-only` is handled outside this file, by `--conditions=react-server` on the node command:
 * that is the condition the package's own `exports` map resolves to an empty module, which is
 * exactly what a Server Component build does.
 */

/** The frontend package root, which is what `@/` means in tsconfig's `paths`. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  const resolved = specifier.startsWith('@/')
    ? pathToFileURL(path.join(PACKAGE_ROOT, specifier.slice('@/'.length))).href
    : specifier;

  try {
    return await nextResolve(resolved, context);
  } catch (error) {
    // Only a path-like specifier gets the `.ts` retry; a bare package name that failed to
    // resolve is a real missing dependency and must say so.
    if (!resolved.startsWith('.') && !resolved.startsWith('/') && !resolved.startsWith('file:')) {
      throw error;
    }
    try {
      return await nextResolve(`${resolved}.ts`, context);
    } catch {
      return await nextResolve(`${resolved}/index.ts`, context);
    }
  }
}
