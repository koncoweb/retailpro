/**
 * GET /api/health
 *
 * Deployment smoke check (also proves the `vercel.json` rewrite no longer
 * swallows `/api/*`).
 */
import { optionalEnv } from '../server/env';
import { sendJson, withErrors, type ApiRequest, type ApiResponse } from '../server/http';

async function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, {
    ok: true,
    service: 'retailpro-api',
    time: new Date().toISOString(),
    tursoOrg: optionalEnv('TURSO_ORG_SLUG') ?? null,
    group: optionalEnv('TURSO_GROUP') ?? null,
    controlDbConfigured: Boolean(optionalEnv('CONTROL_DB_URL')),
  });
}

export default withErrors(handler);
