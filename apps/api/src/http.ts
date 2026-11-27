/** Errors the routes throw, and the one place that turns every failure into the contract's error body. */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z, ZodError } from 'zod';
import type { ErrorBody } from '@kaabil/contract';

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const forbidden = (m = 'You cannot do that') => new HttpError(403, 'forbidden', m);
export const unauthorized = (m = 'Sign in first') => new HttpError(401, 'unauthorized', m);

export const body = (code: string, message: string): ErrorBody => ({ error: { code, message } });

/** Parse a JSON request body against a schema. Unknown fields and wrong types become a 400. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, 'invalid_body', summarise(r.error));
  return r.data;
}

function summarise(e: ZodError): string {
  const first = e.issues[0];
  return first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request';
}

export function onError(err: Error, c: Context) {
  if (err instanceof HttpError) return c.json(body(err.code, err.message), err.status);
  if (err instanceof ZodError) return c.json(body('invalid_body', summarise(err)), 400);
  // Anything else is ours to fix. Say nothing about the cause to the caller, and do not log request content.
  const log = c.get('log') as { error: (o: object, m: string) => void } | undefined;
  log?.error({ err: err.message, path: c.req.path }, 'unhandled error');
  return c.json(body('internal_error', 'Something went wrong on our side'), 500);
}
