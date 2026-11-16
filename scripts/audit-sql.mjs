/**
 * Static SQL audit — not shipped, dev-only safety net for the SQLite migration.
 *
 * Scans src/**.ts(x) for SQL string/template literals, translates `$n` to `?`
 * and executes each statement against a scratch database built from
 * db/schema/tenant.sql. Any "no such table" / "no such column" / syntax error
 * means a call site no longer matches the schema.
 *
 * Usage: node scripts/audit-sql.mjs
 *        node scripts/audit-sql.mjs --show-comments
 *
 * `--show-comments` lists every SQL-shaped literal that was dropped because it
 * sits inside a comment. The exclusion is a judgement call, so it has to be
 * auditable: without a listing, "that literal is documentation" is an
 * unverifiable claim, and a real call site could hide behind it.
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

/**
 * Ranges of `//`…EOL and `/*`…`*`/ comments in a source file.
 *
 * The collector below scans quoted text, and documentation quotes real
 * statements: a JSDoc that says a page used to run `UPDATE users` was collected
 * as if it were a call site and reported as `SYNTAX | incomplete input`. Only
 * code can be a call site, so comment ranges are excluded. Strings are stepped
 * over while scanning so a `//` inside a URL or a SQL literal does not open a
 * comment. A quote inside a regular-expression literal can still desync this
 * scan; the auditor is a safety net, not a parser, and the worst case is that
 * one literal near it is skipped.
 */
function commentRanges(src) {
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      ranges.push([i, stop]);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      ranges.push([i, stop]);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        // Single- and double-quoted strings cannot span a line: if the quote
        // was not a string after all, resume one character later.
        if (src[j] === '\n' && ch !== '`') { j = i + 1; break; }
        if (src[j] === ch) { j += 1; break; }
        j += 1;
      }
      i = Math.max(j, i + 1);
      continue;
    }
    i += 1;
  }
  return ranges;
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
const commentSkips = [];
let inComments = 0;
const showComments = process.argv.includes('--show-comments');
const lineOf = (src, index) => src.slice(0, index).split('\n').length;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const ranges = commentRanges(src);
  const insideComment = (index) => ranges.some(([start, end]) => index >= start && index < end);
  let m;
  includeRe.lastIndex = 0;
  while ((m = includeRe.exec(src))) {
    // A statement quoted in documentation is not a call site.
    if (insideComment(m.index)) {
      const body = (m[1] ?? m[2] ?? '').trim();
      if (sqlHead.test(body)) {
        inComments += 1;
        commentSkips.push(
          `${path.relative(root, file)}:${lineOf(src, m.index)}: ${body.replace(/\s+/g, ' ').slice(0, 110)}`
        );
      }
      continue;
    }
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
console.log(`skipped (comments)  : ${inComments}`);
if (showComments) {
  for (const site of commentSkips) console.log(`  ~ ${site}`);
}
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
