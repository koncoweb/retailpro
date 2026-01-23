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
  tenantId: string;
  branchId: string;
  role: string;
  timestamp: number;
}

let userCache: UserCache | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const query = async (text: string, params?: any[]) => {
  const client = await pool.connect();
  try {
    const session = await authClient.getSession();
    const userId = session.data?.user?.id;

    if (!userId) {
      // Not authenticated, run as is (RLS will likely block or rely on public access)
      return await client.query(text, params);
    }

    // Cache logic
    if (!userCache || userCache.userId !== userId || Date.now() - userCache.timestamp > 60000) {
      // Need to set current_user_id to allow reading own user record
      await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
      
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
      }
    }

    if (userCache && userCache.userId === userId) {
      try {
        await client.query('BEGIN');
        
        // Set session variables for RLS
        // We use simple string interpolation because UUIDs/Strings are safe here 
        // and we control the cache.
        await client.query(`
          SET LOCAL app.current_user_id = '${userCache.userId}';
          SET LOCAL app.current_tenant_id = '${userCache.tenantId || ''}';
          SET LOCAL app.current_branch_id = '${userCache.branchId || ''}';
          SET LOCAL app.user_role = '${userCache.role || 'guest'}';
        `);

        const res = await client.query(text, params);
        
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    // Fallback if user record not found
    return await client.query(text, params);

  } finally {
    client.release();
  }
};
