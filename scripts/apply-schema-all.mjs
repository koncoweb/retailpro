#!/usr/bin/env node
/**
 * Fleet drift guard: brings every registered tenant database up to the schema
 * version shipped in this repo.
 *
 *   node scripts/apply-schema-all.mjs            # dry run
 *   node scripts/apply-schema-all.mjs --apply    # actually apply
 *   node scripts/apply-schema-all.mjs --apply --only rp-acme-8f3k2
 *
 * `db/schema/tenant.sql` creates tables with IF NOT EXISTS, so it is safe to
 * re-apply, but it cannot ADD a column to a table that already exists. Anything
 * that changes an existing table must therefore live in `db/migrations/` as a
 * numbered file: the runner applies every migration newer than the tenant's
 * recorded version, then re-applies tenant.sql to pick up new tables/indexes.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

/** Bump together with the newest statement in db/schema/tenant.sql. */
const CURRENT_SCHEMA_VERSION = 5;

const API_BASE = 'https://api.turso.tech/v1';
const here = dirname(fileURLToPath(import.meta.url));
const schemaRoot = join(here, '..', 'db');
const tenantSql = readFileSync(join(schemaRoot, 'schema', 'tenant.sql'), 'utf8');

/**
 * Migrations are named `<version>_<slug>.sql`; the numeric prefix is the
 * schema version they produce. Ordered ascending, never renumbered.
 */
const migrations = readdirSync(join(schemaRoot, 'migrations'))
  .filter((file) => /^\d+_.*\.sql$/.test(file))
  .map((file) => ({
    version: Number(file.split('_')[0]),
    file,
    sql: readFileSync(join(schemaRoot, 'migrations', file), 'utf8'),
  }))
  .sort((a, b) => a.version - b.version);

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const onlyIndex = argv.indexOf('--only');
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;

const apiToken = process.env.TURSO_API_TOKEN;
const org = process.env.TURSO_ORG_SLUG;
const controlUrl = process.env.CONTROL_DB_URL;
const controlToken = process.env.CONTROL_DB_TOKEN;

function die(message) {
  console.error(`\n[x] ${message}\n`);
  process.exit(1);
}

if (!apiToken) die('TURSO_API_TOKEN is not set.');
if (!org) die('TURSO_ORG_SLUG is not set.');
if (!controlUrl) die('CONTROL_DB_URL is not set.');

async function mintToken(dbName, expiration = '15m') {
  const response = await fetch(
    `${API_BASE}/organizations/${org}/databases/${encodeURIComponent(dbName)}/auth/tokens` +
      `?expiration=${expiration}&authorization=full-access`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    }
  );
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
  }
  if (!response.ok) {
    throw new Error(`mint token for ${dbName} -> ${response.status} ${parsed.error ?? ''}`);
  }
  const jwt = parsed.jwt ?? parsed.token;
  if (!jwt) throw new Error(`no token returned for ${dbName}`);
  return jwt;
}

async function readVersion(client) {
  try {
    const result = await client.execute('SELECT version FROM schema_version WHERE id = 1');
    if (result.rows.length === 0) return 0;
    return Number(result.rows[0].version ?? 0);
  } catch (error) {
    if (String(error.message ?? error).includes('no such table')) return 0;
    throw error;
  }
}

async function main() {
  const control = createClient({ url: controlUrl, authToken: controlToken });
  let tenants;
  try {
    const result = await control.execute({
      sql: `SELECT id, slug, db_name, db_hostname, status FROM tenant_databases ORDER BY created_at`,
      args: [],
    });
    tenants = result.rows;
  } finally {
    control.close();
  }

  if (only) {
    tenants = tenants.filter((row) => row.db_name === only || row.slug === only);
  }

  console.log(`[i] ${tenants.length} tenant database(s) registered.`);
  console.log(`[i] Target schema version: ${CURRENT_SCHEMA_VERSION}`);
  console.log(`[i] Mode: ${apply ? 'APPLY' : 'dry run (pass --apply)'}\n`);

  let behind = 0;
  let updated = 0;
  let failed = 0;

  for (const tenant of tenants) {
    const dbName = tenant.db_name;
    const url = tenant.db_hostname?.startsWith('http')
      ? tenant.db_hostname
      : `libsql://${tenant.db_hostname}`;

    let client;
    try {
      const jwt = await mintToken(dbName);
      client = createClient({ url, authToken: jwt });
      const version = await readVersion(client);

      if (version >= CURRENT_SCHEMA_VERSION) {
        console.log(`[=] ${dbName}: up to date (v${version})`);
        continue;
      }

      behind += 1;
      const pending = migrations.filter((migration) => migration.version > version);

      if (!apply) {
        const steps = [
          ...pending.map((migration) => `${migration.file}`),
          'tenant.sql',
        ].join(' -> ');
        console.log(`[-] ${dbName}: v${version} -> v${CURRENT_SCHEMA_VERSION} (would apply ${steps})`);
        continue;
      }

      // A virgin database has no tables at all: tenant.sql creates everything.
      // An existing one needs its ALTERs first, because tenant.sql now indexes
      // columns (warehouse_id) that only the migration can add.
      if (version > 0) {
        for (const migration of pending) {
          await client.executeMultiple(`BEGIN;\n${migration.sql}\nCOMMIT;`);
          console.log(`    [+] ${dbName}: applied ${migration.file}`);
        }
      }

      await client.executeMultiple(tenantSql);
      await client.execute({
        sql: `INSERT INTO schema_version (id, version, applied_at)
              VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              ON CONFLICT (id) DO UPDATE SET
                version = excluded.version,
                applied_at = excluded.applied_at`,
        args: [CURRENT_SCHEMA_VERSION],
      });
      updated += 1;
      console.log(`[+] ${dbName}: v${version} -> v${CURRENT_SCHEMA_VERSION}`);
    } catch (error) {
      failed += 1;
      console.error(`[x] ${dbName}: ${error.message ?? error}`);
    } finally {
      client?.close();
    }
  }

  console.log(
    `\n[i] behind: ${behind}, updated: ${updated}, failed: ${failed}, total: ${tenants.length}`
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`\n[x] ${error.message}\n`);
  process.exit(1);
});
