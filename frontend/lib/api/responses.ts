/**
 * Shared response helpers for Route Handlers.
 * Centralises status codes and JSON envelope so every handler looks the same.
 */

/** Return a successful JSON response (default 200). */
export function jsonOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Return an error JSON response with `{ error: message }` envelope. */
export function jsonError(status: number, message: string, details?: unknown): Response {
  const body: { error: string; details?: unknown } = { error: message };
  if (details !== undefined) {
    body.details = details;
  }
  return Response.json(body, { status });
}
