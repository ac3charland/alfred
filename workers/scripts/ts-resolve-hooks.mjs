/**
 * An ESM resolve hook that lets a dev script import the Worker's own modules.
 *
 * Node runs a `.ts` file directly by stripping its types, which is what makes a script like
 * `comms-eval.ts` possible without a build step — but stripping types does not add a module
 * resolver. The Worker's source is written for a bundler, so every internal import is
 * extensionless (`./verdict`, `../prompt`), and Node's ESM resolver refuses those: it looks for a
 * file called exactly `verdict` and reports ERR_MODULE_NOT_FOUND from inside a module the script
 * never named.
 *
 * The alternative to these fifteen lines is either a build step for a script whose whole point is
 * to be run once by hand, or rewriting every import in the Worker to carry an extension. So the
 * hook fills the one gap: when a RELATIVE specifier does not resolve, try it again as `.ts`.
 * Anything else — a bare package name, a specifier that resolves normally — is untouched.
 */

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      return await nextResolve(`${specifier}/index.ts`, context);
    }
  }
}
