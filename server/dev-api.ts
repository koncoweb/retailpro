/**
 * Local API server for development.
 *
 * `vercel dev` does the same thing but needs the Vercel CLI; this server lets
 * `npm run dev:api` + `npm run dev:spa` reproduce production locally (cookies,
 * same-origin `/api`, no CORS) without it. It is never deployed.
 *
 * Run: npm run dev:api   (default port 3000)
 */
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse } from 'node:url';

const PORT = Number(process.env.PORT ?? 3000);

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

interface Route {
  pattern: RegExp;
  load: () => Promise<{ default: Handler }>;
}

const routes: Route[] = [
  { pattern: /^\/api\/health\/?$/, load: () => import('../api/health') },
  {
    pattern: /^\/api\/auth(?:\/.*)?$/,
    load: () => import('../api/auth/[...all]'),
  },
  { pattern: /^\/api\/tenant\/bootstrap\/?$/, load: () => import('../api/tenant/bootstrap') },
  { pattern: /^\/api\/tenant\/token\/?$/, load: () => import('../api/tenant/token') },
  {
    pattern: /^\/api\/tenant\/provision\/?$/,
    load: () => import('../api/tenant/provision'),
  },
  { pattern: /^\/api\/admin\/users\/?$/, load: () => import('../api/admin/users') },
  {
    pattern: /^\/api\/admin\/users\/([^/]+)\/password\/?$/,
    load: () => import('../api/admin/users/[id]/password'),
  },
];

const server = createServer(async (req, res) => {
  const url = parse(req.url ?? '/', true);
  const pathname = url.pathname ?? '/';

  const route = routes.find((candidate) => candidate.pattern.test(pathname));
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found', path: pathname }));
    return;
  }

  // Mirror what the platform provides: `req.query` populated from the URL.
  const request = req as IncomingMessage & { query?: Record<string, string | string[]> };
  request.query = url.query as Record<string, string | string[]>;

  try {
    const module = await route.load();
    await module.default(req, res);
  } catch (error) {
    console.error(`[dev-api] ${req.method} ${pathname} failed:`, error);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[dev-api] listening on http://localhost:${PORT}`);
  console.log('[dev-api] routes: /api/health, /api/auth/*, /api/tenant/*, /api/admin/users*');
});
