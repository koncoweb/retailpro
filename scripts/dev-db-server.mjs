/**
 * Local libSQL endpoint for development.
 *
 * The SPA talks to its tenant database through `@libsql/client/web`, which only
 * speaks HTTP/WebSocket to a libSQL server — a plain `file:` database cannot be
 * opened from the browser. Turso's `sqld` is not available on Windows and the
 * cloud databases need a platform token, so this server implements just enough
 * of the Hrana v2 HTTP protocol (`POST /v2/pipeline`) on top of the normal
 * `@libsql/client`. It is never deployed.
 *
 *   node scripts/dev-db-server.mjs --db .data/demo/thalia.db --port 8090
 *
 * Then register the tenant with `db_hostname = http://127.0.0.1:8090`; the app
 * mints a placeholder token for loopback hosts (see `mintTenantToken`).
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';

function parseArgs(argv) {
  const options = { db: '.data/demo/thalia.db', port: 8090 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db' || arg === '--database') options.db = argv[++index] ?? options.db;
    else if (arg === '--port') options.port = Number(argv[++index] ?? options.port);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/dev-db-server.mjs [--db <file>] [--port <n>]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const dbPath = resolve(options.db);
const DB_URL = `file:${dbPath}`;

/** Streams are keyed by baton: they keep one connection alive across requests. */
const streams = new Map();
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function openStream() {
  return {
    client: createClient({ url: DB_URL }),
    tx: null,
    sql: new Map(),
    autocommit: true,
    lastUsed: Date.now(),
  };
}

function closeStream(baton, stream) {
  try {
    stream.tx?.close();
  } catch {
    // already closed
  }
  try {
    stream.client.close();
  } catch {
    // already closed
  }
  if (baton) streams.delete(baton);
}

/**
 * The node binding commits implicitly between `execute()` calls, so an explicit
 * BEGIN/COMMIT pair cannot be passed straight through: the shim keeps a real
 * libSQL transaction open for the lifetime of the stream instead.
 */
function transactionMode(beginSql) {
  const upper = beginSql.toUpperCase();
  if (upper.includes('IMMEDIATE')) return 'write';
  if (upper.includes('EXCLUSIVE')) return 'write';
  return 'deferred';
}

// ---------------------------------------------------------------------------
// Hrana value encoding
// ---------------------------------------------------------------------------

function decodeValue(value) {
  if (value === undefined || value === null) return null;
  switch (value.type) {
    case 'null':
      return null;
    case 'integer':
      return BigInt(value.value);
    case 'float':
      return value.value;
    case 'text':
      return value.value;
    case 'blob':
      return Buffer.from(value.base64, 'base64');
    default:
      return null;
  }
}

function encodeValue(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value };
  }
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'string') return { type: 'text', value };
  if (value instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  }
  if (value instanceof ArrayBuffer) {
    return { type: 'blob', base64: Buffer.from(new Uint8Array(value)).toString('base64') };
  }
  return { type: 'text', value: String(value) };
}

function encodeResult(result) {
  const columns = result.columns ?? [];
  return {
    cols: columns.map((name) => ({ name, decltype: null })),
    rows: result.rows.map((row) => columns.map((name) => encodeValue(row[name]))),
    affected_row_count: result.rowsAffected ?? 0,
    last_insert_rowid:
      result.lastInsertRowid === undefined || result.lastInsertRowid === null
        ? null
        : String(result.lastInsertRowid),
    rows_read: 0,
    rows_written: result.rowsAffected ?? 0,
  };
}

function statementSql(stream, stmt) {
  if (typeof stmt.sql === 'string') {
    if (stmt.sql_id !== undefined) stream.sql.set(stmt.sql_id, stmt.sql);
    return stmt.sql;
  }
  if (stmt.sql_id !== undefined) {
    const cached = stream.sql.get(stmt.sql_id);
    if (cached === undefined) throw new Error(`Unknown sql_id ${stmt.sql_id}`);
    return cached;
  }
  throw new Error('Statement carries neither sql nor sql_id');
}

const EMPTY_RESULT = {
  cols: [],
  rows: [],
  affected_row_count: 0,
  last_insert_rowid: null,
  rows_read: 0,
  rows_written: 0,
};

async function runStatement(stream, stmt) {
  const sql = statementSql(stream, stmt);
  const args = (stmt.args ?? []).map(decodeValue);
  const namedArgs = Object.fromEntries(
    (stmt.named_args ?? []).map((entry) => [entry.name, decodeValue(entry.value)])
  );
  const statement =
    Object.keys(namedArgs).length > 0 ? { sql, args: namedArgs } : { sql, args };
  const head = sql.trim().toUpperCase();

  if (head.startsWith('BEGIN')) {
    stream.tx = await stream.client.transaction(transactionMode(sql));
    stream.autocommit = false;
    return EMPTY_RESULT;
  }
  if (head.startsWith('COMMIT') || head.startsWith('END')) {
    if (stream.tx) {
      const tx = stream.tx;
      stream.tx = null;
      await tx.commit();
      tx.close();
    }
    stream.autocommit = true;
    return EMPTY_RESULT;
  }
  if (head.startsWith('ROLLBACK')) {
    if (stream.tx) {
      const tx = stream.tx;
      stream.tx = null;
      await tx.rollback();
      tx.close();
    }
    stream.autocommit = true;
    return EMPTY_RESULT;
  }

  const result = await (stream.tx ?? stream.client).execute(statement);
  return encodeResult(result);
}

function evaluateCondition(condition, stepResults, stepErrors, stream) {
  if (!condition) return true;
  switch (condition.type) {
    case 'ok':
      return stepResults[condition.step] !== null && stepResults[condition.step] !== undefined;
    case 'error':
      return Boolean(stepErrors[condition.step]);
    case 'not':
      return !evaluateCondition(condition.cond, stepResults, stepErrors, stream);
    case 'and':
      return condition.conds.every((cond) => evaluateCondition(cond, stepResults, stepErrors, stream));
    case 'or':
      return condition.conds.some((cond) => evaluateCondition(cond, stepResults, stepErrors, stream));
    case 'is_autocommit':
      return stream.autocommit;
    default:
      return false;
  }
}

async function runBatch(stream, batch) {
  const steps = batch?.steps ?? [];
  const stepResults = new Array(steps.length).fill(null);
  const stepErrors = new Array(steps.length).fill(null);

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    try {
      if (!evaluateCondition(step.condition, stepResults, stepErrors, stream)) continue;
      stepResults[index] = await runStatement(stream, step.stmt);
    } catch (error) {
      stepErrors[index] = {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code ?? 'SQLITE_ERROR',
      };
    }
  }

  return { step_results: stepResults, step_errors: stepErrors };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

async function handlePipeline(rawBody) {
  const body = rawBody ? JSON.parse(rawBody) : {};
  const requests = body.requests ?? [];
  const incomingBaton = body.baton ?? null;

  let stream = incomingBaton ? streams.get(incomingBaton) : undefined;
  let createdBaton = null;
  if (!stream) {
    stream = openStream();
    createdBaton = randomUUID();
  }
  stream.lastUsed = Date.now();

  const results = [];
  let closed = false;

  for (const request of requests) {
    try {
      switch (request.type) {
        case 'execute':
          results.push({
            type: 'ok',
            response: { type: 'execute', result: await runStatement(stream, request.stmt) },
          });
          break;
        case 'batch':
          results.push({
            type: 'ok',
            response: { type: 'batch', result: await runBatch(stream, request.batch) },
          });
          break;
        case 'sequence': {
          const sql = statementSql(stream, request);
          await stream.client.executeMultiple(sql);
          stream.autocommit = !/\bBEGIN\b/i.test(sql) || /\bCOMMIT\b/i.test(sql);
          results.push({ type: 'ok', response: { type: 'sequence' } });
          break;
        }
        case 'store_sql':
          stream.sql.set(request.sql_id, request.sql);
          results.push({ type: 'ok', response: { type: 'store_sql' } });
          break;
        case 'close_sql':
          stream.sql.delete(request.sql_id);
          results.push({ type: 'ok', response: { type: 'close_sql' } });
          break;
        case 'get_autocommit':
          results.push({
            type: 'ok',
            response: { type: 'get_autocommit', is_autocommit: stream.autocommit },
          });
          break;
        case 'describe':
          results.push({
            type: 'ok',
            response: {
              type: 'describe',
              result: { params: [], cols: [], is_explain: false, is_readonly: true },
            },
          });
          break;
        case 'close':
          closed = true;
          results.push({ type: 'ok', response: { type: 'close' } });
          break;
        default:
          results.push({
            type: 'error',
            error: { message: `Unsupported request type: ${request.type}`, code: 'UNSUPPORTED' },
          });
      }
    } catch (error) {
      results.push({
        type: 'error',
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: error?.code ?? 'SQLITE_ERROR',
        },
      });
    }
  }

  if (closed) {
    closeStream(incomingBaton, stream);
    return { baton: null, results };
  }

  const baton = incomingBaton ?? createdBaton;
  streams.set(baton, stream);
  return { baton, results };
}

const server = createServer(async (req, res) => {
  // The SPA runs on another port, so every Hrana call is a cross-origin POST.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const pathname = (req.url ?? '/').split('?')[0];

  if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
    sendJson(res, 200, { status: 'ok', database: dbPath, streams: streams.size, protocol: 'hrana-v2' });
    return;
  }

  if (pathname === '/v2' || pathname === '/v3' || pathname === '/v3-protobuf') {
    // Version probe: answering 200 would make the client switch to protobuf,
    // so v3 paths are advertised as unavailable.
    if (pathname === '/v2') sendJson(res, 200, { version: 2 });
    else sendJson(res, 404, { message: 'Only the Hrana v2 HTTP protocol is implemented' });
    return;
  }

  if (req.method !== 'POST' || pathname !== '/v2/pipeline') {
    sendJson(res, 404, { message: `Not found: ${req.method} ${pathname}` });
    return;
  }

  try {
    const body = await readBody(req);
    const payload = await handlePipeline(body);
    sendJson(res, 200, payload);
  } catch (error) {
    console.error('[dev-db] pipeline failed:', error);
    sendJson(res, 500, { message: error instanceof Error ? error.message : String(error) });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [baton, stream] of streams) {
    if (now - stream.lastUsed > IDLE_TIMEOUT_MS) {
      console.log('[dev-db] closing idle stream', baton);
      closeStream(baton, stream);
    }
  }
}, 60_000).unref();

server.listen(options.port, '127.0.0.1', () => {
  console.log(`[dev-db] libSQL (Hrana v2) on http://127.0.0.1:${options.port}`);
  console.log(`[dev-db] database: ${dbPath}`);
  console.log('[dev-db] dev only — never deploy this.');
});
