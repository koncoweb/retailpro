/**
 * Better Auth catch-all: sign-in, sign-up, sign-out, session, admin, ...
 * Mounted at /api/auth/*
 */
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../server/auth.js';

// Better Auth needs the raw body to verify signatures and parse form posts.
export const config = {
  api: { bodyParser: false },
};

export default toNodeHandler(auth.handler);
