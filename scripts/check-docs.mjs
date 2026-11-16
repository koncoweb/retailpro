/**
 * Documentation gate — dev-only, not shipped.
 *
 * Each of these four checks caught a real mistake while the vendor-product
 * integration was written, and each was previously found by hand:
 *
 *   1. Markdown tables: every row must have the same cell count as its header.
 *      Physical newlines or stray pipes inside a cell silently split a row and
 *      render the whole table wrong. Code fences are skipped, and `\|` counts as
 *      literal text, not a cell separator.
 *   2. Schema version is one number in three places: the stamp row in
 *      `db/schema/tenant.sql`, `CURRENT_SCHEMA_VERSION` in
 *      `scripts/apply-schema-all.mjs`, and the highest prefix in `db/migrations`.
 *      Docs quote that number, so drift here means every "schema vN" claim lies.
 *   3. The README documentation index must list every file in `docs/`, and every
 *      file it names must exist — a new spec that never reaches the index is
 *      invisible.
 *   4. A section anchor written as `[foo.md](foo.md) §N` must point at a real
 *      heading in that file. Dead `§N` refs shipped twice in this repo, and the
 *      body of a frozen spec is where they hide longest. Only the section number
 *      is checked, never a sub-item: `§15 poin 3` is a house convention that no
 *      heading can prove, so it stays a rule in `docs/kendala-solusi.md`.
 *
 * Usage: node scripts/check-docs.mjs                 (exit 1 on any problem)
 *        node scripts/check-docs.mjs --root <dir>     (run against a fixture)
 *
 * Positive control — a gate must be able to fail, so `scripts/__fixtures__/docs-
 * check/` plants one defect per check and must report exactly 8 problems:
 *   node scripts/check-docs.mjs --root scripts/__fixtures__/docs-check
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1
  ? process.cwd()
  : path.resolve(process.cwd(), process.argv[rootFlag + 1]);
const problems = [];
let tableRows = 0;
let anchors = 0;
const report = (file, line, message) =>
  problems.push(`${path.relative(root, file)}${line ? `:${line}` : ''}: ${message}`);

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** Markdown files the gate owns: the three living docs at the root plus docs/. */
function markdownFiles() {
  const out = ['README.md', 'requirement.md', 'CHANGELOG.md'].map((name) => path.join(root, name));
  const docsDir = path.join(root, 'docs');
  if (existsSync(docsDir)) {
    for (const entry of readdirSync(docsDir)) if (entry.endsWith('.md')) out.push(path.join(docsDir, entry));
  }
  return out.filter((file) => existsSync(file));
}

/** Cell count of a table row, treating `\|` as literal text. */
const cellCount = (line) =>
  line
    .trim()
    .replace(/\\\|/g, '\u0000')
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|').length;

const isSeparator = (line) => /^[\s:|-]+$/.test(line.trim()) && line.includes('-');

// 1. Table shape.
function checkTables(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let header = null;
  let headerLine = 0;
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = !fence;
      header = null;
      continue;
    }
    if (fence || !trimmed.startsWith('|')) {
      header = null;
      continue;
    }
    if (header === null) {
      // A separator can only follow a header, so a lone `|---|` row means the
      // header was the previous line: treat this row as the start of a table.
      if (isSeparator(trimmed)) continue;
      header = cellCount(trimmed);
      headerLine = i + 1;
      continue;
    }
    if (isSeparator(trimmed)) continue;
    const cols = cellCount(trimmed);
    tableRows += 1;
    if (cols !== header) {
      report(file, i + 1, `table row has ${cols} cells, its header (line ${headerLine}) has ${header}`);
    }
  }
}

// 2. One schema version everywhere.
function checkSchemaVersion() {
  const schema = readIf(path.join(root, 'db', 'schema', 'tenant.sql'));
  const stamp = schema.match(/INSERT OR IGNORE INTO schema_version \(id, version\) VALUES \(1, (\d+)\)/);
  const runner = readIf(path.join(root, 'scripts', 'apply-schema-all.mjs'));
  const target = runner.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/);
  const migrationsDir = path.join(root, 'db', 'migrations');
  const migrations = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
      .map((name) => Number(name.match(/^(\d+)_/)?.[1]))
      .filter((num) => Number.isFinite(num))
    : [];
  const highest = migrations.length ? Math.max(...migrations) : 0;

  if (!stamp) report(path.join(root, 'db', 'schema', 'tenant.sql'), 0, 'no schema_version stamp row found');
  if (!target) report(path.join(root, 'scripts', 'apply-schema-all.mjs'), 0, 'no CURRENT_SCHEMA_VERSION found');
  if (stamp && target && stamp[1] !== target[1]) {
    report(path.join(root, 'db', 'schema', 'tenant.sql'), 0, `stamp is v${stamp[1]} but apply-schema-all targets v${target[1]}`);
  }
  if (target && Number(target[1]) !== highest) {
    report(path.join(root, 'db', 'migrations'), 0, `highest migration is ${highest} but CURRENT_SCHEMA_VERSION is ${target[1]}`);
  }
  return stamp?.[1] ?? target?.[1] ?? String(highest);
}

// 3. README documentation index covers docs/.
function checkDocIndex() {
  const readme = readIf(path.join(root, 'README.md'));
  const indexed = new Set(
    [...readme.matchAll(/docs\/([A-Za-z0-9._-]+\.md)/g)].map((match) => match[1])
  );
  const docsDir = path.join(root, 'docs');
  const onDisk = existsSync(docsDir)
    ? readdirSync(docsDir).filter((name) => name.endsWith('.md'))
    : [];

  for (const name of onDisk) {
    if (!indexed.has(name)) report(path.join(root, 'docs', name), 0, 'not listed in the README documentation index');
  }
  for (const name of indexed) {
    if (!existsSync(path.join(root, 'docs', name))) {
      report(path.join(root, 'README.md'), 0, `index points at docs/${name}, which does not exist`);
    }
  }
}

// 4. Cross-document section anchors.
const headingNumbers = new Map();
function sectionsOf(file) {
  if (!headingNumbers.has(file)) {
    const found = new Set();
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^#{1,4}\s+(\d+)(?:\.\d+)?(?=[.\s)]|$)/);
        if (match) found.add(match[1]);
      }
    }
    headingNumbers.set(file, found);
  }
  return headingNumbers.get(file);
}

/** `[foo.md](foo.md)` is relative to the linking file, so try both bases. */
function resolveLink(fromFile, target) {
  const dir = path.dirname(fromFile);
  for (const candidate of [path.join(dir, target), path.join(root, target), path.join(root, 'docs', target)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function checkAnchors(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    for (const match of lines[i].matchAll(/\]\(([A-Za-z0-9._-]+\.md)\)\s*§(\d+)/g)) {
      anchors += 1;
      const target = resolveLink(file, match[1]);
      if (!target) {
        report(file, i + 1, `links to ${match[1]}, which is not on disk`);
        continue;
      }
      if (!sectionsOf(target).has(match[2])) {
        report(file, i + 1, `§${match[2]} does not name a section of ${match[1]}`);
      }
    }
  }
}

const files = markdownFiles();
for (const file of files) checkTables(file);
const version = checkSchemaVersion();
checkDocIndex();
for (const file of files) checkAnchors(file);

console.log(`markdown files checked : ${files.length}`);
console.log(`schema version         : v${version}`);
// Coverage, not just verdict: a gate that quietly matched zero rows would still
// print OK, which is the failure mode this script exists to prevent.
console.log(`table rows checked     : ${tableRows}`);
console.log(`cross-doc §refs checked : ${anchors}`);
if (problems.length === 0) {
  console.log('docs check             : OK');
} else {
  console.log(`docs check             : ${problems.length} problem(s)`);
  for (const problem of problems) console.log(`  - ${problem}`);
}
process.exit(problems.length === 0 ? 0 : 1);
