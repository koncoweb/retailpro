/**
 * Minimal HTTP helpers shared by the `api/` handlers.
 *
 * Deliberately dependency-free: the handlers work on plain Node
 * `IncomingMessage` / `ServerResponse` so they run unchanged under `vercel dev`,
 * Vercel functions, and the local dev server in `server/dev-api.ts`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ApiRequest = IncomingMessage & {
  method?: string;
  /** Set by Vercel; parsed lazily by `readJsonBody` when absent. */
  body?: unknown;
  query?: Record<string, string | string[]>;
};

export type ApiResponse = ServerResponse;

export class HttpError extends Error {
  status: number;
  code: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(status: number, code: string, message?: string, details?: any) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res: ApiResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export async function readJsonBody<T = Record<string, unknown>>(req: ApiRequest): Promise<T> {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return req.body as T;
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    return JSON.parse(req.body) as T;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {} as T;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function methodNotAllowed(res: ApiResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: 'method_not_allowed', allowed });
}

/**
 * Wraps a handler so unexpected errors become a JSON 500 instead of a crash,
 * and so `HttpError` keeps its status.
 */
export function withErrors(
  handler: (req: ApiRequest, res: ApiResponse) => Promise<void>
): (req: ApiRequest, res: ApiResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.writableEnded) return;
      if (error instanceof HttpError) {
        sendJson(res, error.status, {
          error: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[api] unhandled error on ${req.method} ${req.url}:`, error);
      sendJson(res, 500, { error: 'internal_error', message });
    }
  };
}
