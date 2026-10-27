#!/usr/bin/env node
/**
 * One-off: create (or adopt) the control-plane database and apply control.sql.
 *
 *   node scripts/bootstrap-control.mjs            # uses CONTROL_DB_NAME or retailpro-control
 *   node scripts/bootstrap-control.mjs --reuse    # skip creation if it already exists
 *
 * Requires TURSO_API_TOKEN, TURSO_ORG_SLUG and TURSO_GROUP. Prints the two env
 * lines for CONTROL_DB_URL / CONTROL_DB_TOKEN to the terminal; it never writes
 * them to a file.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const API_BASE = 'https://api.turso.tech/v1';
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'db', 'schema', 'control.sql');

const args = new Set(process.argv.slice(2));
const reuse = args.has('--reuse');

const token = process.env.TURSO_API_TOKEN;
const org = process.env.TURSO_ORG_SLUG;
const group = process.env.TURSO_GROUP || 'retailpro';
const dbName = process.env.CONTROL_DB_NAME || 'retailpro-control';

function die(message) {
  console.error(`\n[x] ${message}\n`);
  process.exit(1);
}

if (!token) die('TURSO_API_TOKEN is not set (put it in .env.local).');
if (!org) die('TURSO_ORG_SLUG is not set (e.g. koncowebliberation).');

async function turso(endpoint, init = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  if (!response.ok) {
    const message = parsed.error ?? parsed.message ?? `HTTP ${response.status}`;
    throw new Error(`${endpoint} -> ${response.status} ${message}`);
  }
  return parsed;
}

async function findExisting() {
  const data = await turso(`/organizations/${org}/databases`);
  const list = data.databases ?? [];
  return list.find((db) => (db.Name ?? db.name) === dbName) ?? null;
}

async function main() {
  let database = await findExisting();

  if (database) {
    console.log(`[i] Database ${dbName} already exists (${database.Hostname ?? database.hostname}).`);
    if (!reuse) {
      console.log('[i] Re-applying control.sql (idempotent, every statement is IF NOT EXISTS).');
    }
  } else {
    console.log(`[i] Creating database ${dbName} in group ${group} ...`);
    const created = await turso(`/organizations/${org}/databases`, {
      method: 'POST',
      body: JSON.stringify({ name: dbName, group }),
    });
    database = created.database ?? created;
    console.log(`[+] Created ${dbName} at ${database.Hostname ?? database.hostname}`);
  }

  const hostname = database.Hostname ?? database.hostname;
  if (!hostname) die('Turso did not return a hostname for the control database.');

  console.log('[i] Minting a 15 minute token for the DDL ...');
  const minted = await turso(
    `/organizations/${org}/databases/${encodeURIComponent(dbName)}/auth/tokens?expiration=15m&authorization=full-access`,
    { method: 'POST' }
  );
  const jwt = minted.jwt ?? minted.token;
  if (!jwt) die('Turso returned no token.');

  const sql = readFileSync(schemaPath, 'utf8');
  console.log(`[i] Applying control.sql (${sql.split('\n').length} lines) ...`);

  const client = createClient({ url: `libsql://${hostname}`, authToken: jwt });
  try {
    await client.executeMultiple(sql);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    console.log(`[+] Tables: ${tables.rows.map((row) => row.name).join(', ')}`);
  } finally {
    client.close();
  }

  console.log('\n--- Add these to .env.local / Vercel environment variables ---');
  console.log(`CONTROL_DB_URL=libsql://${hostname}`);
  console.log('CONTROL_DB_TOKEN=<mint a dedicated token for this database>');
  console.log('--------------------------------------------------------------\n');
  console.log(
    'Mint the long-lived token with:\n' +
      `  curl -X POST "https://api.turso.tech/v1/organizations/${org}/databases/${dbName}/auth/tokens?expiration=never&authorization=full-access" \\\n` +
      '    -H "Authorization: Bearer $TURSO_API_TOKEN"\n'
  );
}

main().catch((error) => {
  console.error(`\n[x] ${error.message}\n`);
  process.exit(1);
});
