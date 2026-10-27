/**
 * Static SQL audit — not shipped, dev-only safety net for the SQLite migration.
 *
 * Scans src/**.ts(x) for SQL string/template literals, translates `$n` to `?`
 * and executes each statement against a scratch database built from
 * db/schema/tenant.sql. Any "no such table" / "no such column" / syntax error
 * means a call site no longer matches the schema.
 *
 * Usage: node scripts/audit-sql.mjs
 */
import { readFileSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

/** Minimal inline translator (the real one lives in src/lib/db/translate.ts). */
function translate(sql, params = []) {
  let out = '';
  const args = [];
  let state = 'normal';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (state === 'normal') {
      if (ch === "'") { state = 'single'; out += ch; continue; }
      if (ch === '"') { state = 'double'; out += ch; continue; }
      if (ch === '-' && next === '-') { state = 'line-comment'; out += ch; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; out += ch; continue; }
      if (ch === '$' && next >= '0' && next <= '9') {
        let num = '';
        let j = i + 1;
        while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') { num += sql[j]; j += 1; }
        args.push(params[Number(num) - 1] ?? null);
        out += '?';
        i = j - 1;
        continue;
      }
      out += ch;
      continue;
    }
    // Inside a literal or comment: copy verbatim, handling escapes.
    out += ch;
    if (state === 'single' && ch === "'") { if (next === "'") { out += next; i += 1; } else state = 'normal'; }
    else if (state === 'double' && ch === '"') { if (next === '"') { out += next; i += 1; } else state = 'normal'; }
    else if (state === 'line-comment' && ch === '\n') state = 'normal';
    else if (state === 'block-comment' && ch === '*' && next === '/') { out += next; i += 1; state = 'normal'; }
  }
  return { text: out, args };
}

const root = process.cwd();
const sqlDir = path.join(root, '.data');
mkdirSync(sqlDir, { recursive: true });
const dbFile = path.join(sqlDir, 'audit.db');
rmSync(dbFile, { force: true });

const includeRe = /`([^`]*)`|"((?:[^"\\]|\\.)*)"/g;
const sqlHead = /^(SELECT|INSERT|UPDATE|DELETE|WITH|PRAGMA)\b/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(path.join(root, 'src'));
const collected = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = includeRe.exec(src))) {
    const body = (m[1] ?? m[2] ?? '').trim();
    if (!sqlHead.test(body)) continue;
    collected.push({ file: path.relative(root, file), sql: body });
  }
}

const client = createClient({ url: `file:${dbFile}` });
await client.executeMultiple(readFileSync(path.join(root, 'db', 'schema', 'tenant.sql'), 'utf8'));

const bucket = (err) => {
  const msg = String(err?.cause?.message ?? err?.message ?? err);
  if (/no such table/i.test(msg)) return 'MISSING TABLE';
  if (/no such column|has no column named/i.test(msg)) return 'MISSING COLUMN';
  if (/syntax error|incomplete input|unrecognized token/i.test(msg)) return 'SYNTAX';
  return 'RUNTIME';
};

const findings = new Map();
let checked = 0;
let skippedDynamic = 0;
for (const { file, sql } of collected) {
  if (sql.includes('${')) {
    skippedDynamic += 1;
    continue;
  }
  // Not SQL at all: single words (`select`, `update` as audit action names) and
  // documentation snippets (`SELECT ... FOR UPDATE` in a comment).
  if (!/\s/.test(sql.trim()) || sql.includes('...')) {
    skippedDynamic += 1;
    continue;
  }
  let text = sql;
  let args = [];
  try {
    const out = translate(sql, []);
    text = out.text;
    args = new Array(out.args.length).fill(null);
  } catch {
    // Placeholder translation fails when the literal references $n with no
    // params array available statically — count the markers instead.
    const count = (sql.match(/\$\d+/g) ?? []).length;
    text = sql.replace(/\$\d+/g, '?');
    args = new Array(count).fill(null);
  }
  checked += 1;
  try {
    await client.execute({ sql: text, args });
  } catch (err) {
    const kind = bucket(err);
    if (kind === 'RUNTIME') continue;
    const msg = String(err?.cause?.message ?? err?.message ?? err).slice(0, 160);
    const key = `${kind} | ${msg}`;
    if (!findings.has(key)) findings.set(key, []);
    findings.get(key).push(`${file}: ${text.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}

console.log(`statements collected: ${collected.length}`);
console.log(`statements checked  : ${checked}`);
console.log(`skipped (dynamic)   : ${skippedDynamic}`);
console.log(`distinct findings   : ${findings.size}`);
for (const [key, sites] of findings) {
  console.log(`\n### ${key}`);
  for (const site of sites) console.log(`  - ${site}`);
}

client.close();
try {
  rmSync(dbFile, { force: true });
} catch {
  // Windows keeps the libSQL handle open for a moment after close(); the scratch
  // database lives in gitignored `.data/`, so leaving it behind is harmless.
}
