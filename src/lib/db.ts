import { Pool } from '@neondatabase/serverless';
import { authClient } from './auth-client';

const connectionString = import.meta.env.VITE_DATABASE_URL;

if (!connectionString) {
  throw new Error('Missing VITE_DATABASE_URL environment variable');
}

export const pool = new Pool({
  connectionString,
});

interface UserCache {
  userId: string;
  tenantId: string | null;
  branchId: string | null;
  role: string;
  timestamp: number;
}

let userCache: UserCache | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const query = async (text: string, params?: any[]) => {
  const client = await pool.connect();
  try {
    let userId: string | undefined;
    
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = (await authClient.getSession()) as any;
      userId = session.data?.user?.id || session.data?.session?.userId;
    } catch (e) {
      console.warn("Auth session check failed in db query, proceeding as unauthenticated:", e);
      // Fallback to unauthenticated query if session check fails (e.g. 401)
    }

    if (!userId) {
      // Not authenticated, run as is
      return await client.query(text, params);
    }

    try {
      await client.query('BEGIN');

      // 1. Set User ID first (needed for RLS on users table)
      await client.query(`SET LOCAL app.current_user_id = '${userId}'`);

      // 2. Refresh cache if needed
      if (!userCache || userCache.userId !== userId || Date.now() - userCache.timestamp > 60000) {
        const userRes = await client.query(
          `SELECT tenant_id, assigned_branch_id, role FROM users WHERE id = $1`,
          [userId]
        );

        if (userRes.rows.length > 0) {
          const u = userRes.rows[0];
          userCache = {
            userId,
            tenantId: u.tenant_id,
            branchId: u.assigned_branch_id,
            role: u.role,
            timestamp: Date.now()
          };
        } else {
           // User authenticated in Auth but not in public.users?
           console.warn(`User ${userId} authenticated but not found in public.users table`);
           // Clear cache for this user
           userCache = null;
        }
      }

      // 3. Set all session variables
      const role = userCache?.role || 'guest';
      const tenantId = userCache?.tenantId;
      const branchId = userCache?.branchId;
      
      const sessionVars = [`SET LOCAL app.user_role = '${role}';`];
      if (tenantId) sessionVars.push(`SET LOCAL app.current_tenant_id = '${tenantId}';`);
      if (branchId) sessionVars.push(`SET LOCAL app.current_branch_id = '${branchId}';`);
      
      await client.query(sessionVars.join('\n'));

      // 4. Execute actual query
      const res = await client.query(text, params);
      
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
};
