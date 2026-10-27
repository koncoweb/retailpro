/**
 * The single data-access seam.
 *
 * Every data-access call site imports `query` / `runTransaction` from
 * `@/lib/db`. Keeping these two signatures identical to the previous
 * serverless-Postgres implementation (`{ rows, rowCount }`, positional `$n`
 * params) is what let the whole app move to libSQL without touching component
 * logic.
 *
 * Swapping the transport again (e.g. routing through the API) stays a
 * one-file change.
 */
import { getClient, isTokenError, refreshIfNeeded, refreshToken, resetClient } from './client';
import { translate, type TranslatedQuery } from './translate';
import { logger } from '@/lib/logger';

export { DbNotReadyError, DbTokenError } from './client';
export { translate } from './translate';
export { parseJson, parseJsonArray, parseJsonObject } from './json';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  lastInsertRowid?: number | bigint;
}

export interface Transaction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export class DbQueryError extends Error {
  sql: string;
  /** libSQL's underlying error, kept for debugging. */
  cause?: unknown;

  constructor(message: string, sql: string, cause?: unknown) {
    super(message);
    this.name = 'DbQueryError';
    this.sql = sql;
    this.cause = cause;
  }
}

/** First 80 characters of the offending SQL, safe to log. */
function preview(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

function slowQueryCheck(started: number, sql: string): void {
  const duration = performance.now() - started;
  if (duration > 500) {
    logger.warn(`Slow query (${Math.round(duration)}ms): ${preview(sql)}`);
  }
}

/**
 * Runs one statement. Retries exactly once when the failure looks like a stale
 * token, because a refresh is cheap and the alternative is a broken page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const { sql, args } = translate(text, params);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = performance.now();
    try {
      const client = await getClient();
      const result = await client.execute({ sql, args: args as never });
      slowQueryCheck(started, sql);
      return {
        rows: result.rows as unknown as T[],
        rowCount: result.rowsAffected ?? result.rows.length,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (error) {
      if (attempt === 0 && isTokenError(error)) {
        logger.warn(`Token rejected, refreshing and retrying: ${preview(sql)}`);
        resetClient();
        await refreshToken().catch(() => undefined);
        continue;
      }

      logger.error(`Query failed: ${preview(sql)}`, error);
      throw new DbQueryError(
        error instanceof Error ? error.message : String(error),
        preview(sql),
        error
      );
    }
  }

  throw new DbQueryError('Query failed after token refresh', preview(sql));
}

export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

function previewBatch(compiled: TranslatedQuery[]): string {
  return preview(compiled.map((c) => c.sql).join(' | '));
}

/**
 * Runs several statements in a single round-trip.
 *
 * A screen that issues five `query()` calls pays five sequential trips to the
 * tenant database — over a cloud link that dominates the load time. libSQL's
 * `batch()` sends them together and returns the results positionally.
 *
 * Read-only by design: writes belong in `runTransaction` so a partial failure
 * rolls back as a unit.
 */
export async function batchQuery<T = Record<string, unknown>>(
  statements: BatchStatement[]
): Promise<QueryResult<T>[]> {
  if (statements.length === 0) return [];
  const compiled = statements.map((s) => translate(s.sql, s.params ?? []));
  const batch = compiled.map((c) => ({ sql: c.sql, args: c.args as never }));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = performance.now();
    try {
      const client = await getClient();
      // `'read'` tells libSQL the batch cannot write, so it may be retried or
      // routed safely rather than being pinned to a primary.
      const results = await client.batch(batch, 'read');
      slowQueryCheck(started, previewBatch(compiled));
      return results.map((result) => ({
        rows: result.rows as unknown as T[],
        rowCount: result.rowsAffected ?? result.rows.length,
        lastInsertRowid: result.lastInsertRowid,
      }));
    } catch (error) {
      if (attempt === 0 && isTokenError(error)) {
        logger.warn(`Token rejected, refreshing and retrying batch: ${previewBatch(compiled)}`);
        resetClient();
        await refreshToken().catch(() => undefined);
        continue;
      }

      logger.error(`Batch failed: ${previewBatch(compiled)}`, error);
      throw new DbQueryError(
        error instanceof Error ? error.message : String(error),
        previewBatch(compiled),
        error
      );
    }
  }

  throw new DbQueryError('Batch failed after token refresh', previewBatch(compiled));
}

/**
 * Wraps a set of statements in a single write transaction.
 *
 * libSQL serialises writes, so this replaces the `SELECT ... FOR UPDATE` that the
 * Postgres version relied on for stock deduction. The token is refreshed
 * *before* the transaction opens and never inside it: a token rotation midway
 * would silently move the remaining statements to a different connection.
 */
export async function runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  await refreshIfNeeded();
  const client = await getClient();
  const transaction = await client.transaction('write');

  const tx: Transaction = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query<R = any>(sql: string, params: unknown[] = []) {
      const translated = translate(sql, params);
      const result = await transaction.execute({
        sql: translated.sql,
        args: translated.args as never,
      });
      return {
        rows: result.rows as unknown as R[],
        rowCount: result.rowsAffected ?? result.rows.length,
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute<R = any>(sql: string, params: unknown[] = []) {
      return tx.query<R>(sql, params);
    },
  };

  try {
    const result = await fn(tx);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error('Transaction rollback failed', rollbackError);
    }
    throw error;
  }
}

/** Convenience for statements whose result is never read. */
export async function execute(text: string, params: unknown[] = []): Promise<number> {
  const result = await query(text, params);
  return result.rowCount;
}
