/** An error whose name is what the hook log records for it. */
export function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/**
 * What the log says about a thrown value: an errno code (`ENOENT`) or else the error's name.
 * Read by shape rather than `instanceof`, which fails for errors from another realm.
 */
export function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'UnknownError';
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && code !== '') return code;
  return typeof name === 'string' && name !== '' ? name : 'UnknownError';
}
