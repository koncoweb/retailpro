import { Pool } from '@neondatabase/serverless';
import { authClient } from './auth-client';
import { logger } from './logger';

const connectionString = import.meta.env.VITE_DATABASE_URL;

if (!connectionString) {
  logger.error('Missing VITE_DATABASE_URL environment variable');
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let userCache: UserCache | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isValidUuid = (id: any): boolean => {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const getUserId = async (): Promise<string | undefined> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (await authClient.getSession()) as any;
    const uid = session.data?.user?.id || session.data?.session?.userId;
    
    if (isValidUuid(uid)) {
      return uid;
    }
    return undefined;
  } catch (e) {
    logger.warn("Auth session check failed, proceeding as unauthenticated:", e);
    return undefined;
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const query = async (text: string, params?: any[]) => {
  // Get User ID BEFORE acquiring a DB connection to avoid holding it during auth check
  const userId = await getUserId();
  
  const client = await pool.connect();
  
  try {
    if (userId) {
       try {
         await setupSession(client, userId);
       } catch (e) {
         logger.error("setupSession failed:", e);
         throw e;
       }
    } else {
       await clearSession(client);
    }
      
    const start = performance.now();
    const res = await client.query(text, params);
    const duration = performance.now() - start;

    // Log slow queries (> 500ms)
    if (duration > 500) {
        logger.warn(`Slow query detected (${Math.round(duration)}ms): ${text.substring(0, 100)}...`);
    }

    // Only commit if we started a transaction (which setupSession does)
    if (userId) {
        await client.query('COMMIT');
    }
    return res;
  } catch (err) {
    logger.error(`Database query failed: ${text.substring(0, 50)}...`, err);
    if (userId) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            logger.error("Rollback failed:", rollbackError);
        }
    }
    throw err;
  } finally {
    client.release();
  }
};

const clearSession = async (client: any) => {
    // Ensure no leftover session variables from pooled connections
    const sessionVars = [
        `SELECT set_config('app.user_role', 'guest', true);`,
        `SELECT set_config('app.current_user_id', '${NIL_UUID}', true);`,
        `SELECT set_config('app.current_tenant_id', '${NIL_UUID}', true);`,
        `SELECT set_config('app.current_branch_id', '${NIL_UUID}', true);`
    ];
    await client.query(sessionVars.join('\n'));
};

const setupSession = async (client: any, userId: string) => {
    // Extra defensive check to prevent invalid UUID syntax error
    if (!isValidUuid(userId)) {
        console.warn("setupSession called with invalid userId:", userId);
        return;
    }

    await client.query('BEGIN');

    // 1. Initialize session variables (reset potential dirty state from reused connections)
    // We must set tenant_id/branch_id to NIL_UUID *before* querying users table 
    // because RLS on users table might depend on these settings and fail if they are invalid strings.
    await client.query(`
        SELECT set_config('app.current_user_id', '${userId}', true);
        SELECT set_config('app.current_tenant_id', '${NIL_UUID}', true);
        SELECT set_config('app.current_branch_id', '${NIL_UUID}', true);
        SELECT set_config('app.user_role', 'guest', true);
    `);

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
    
    // Always start by resetting potentially dirty variables from reused connections
    // Using set_config with NULL is safer/cleaner for clearing
    const sessionVars = [
        `SELECT set_config('app.user_role', '${role}', true);`,
        `SELECT set_config('app.current_user_id', '${userId}', true);` // Re-assert user_id just in case
    ];

    if (isValidUuid(tenantId)) {
        sessionVars.push(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
    } else {
        sessionVars.push(`SELECT set_config('app.current_tenant_id', '${NIL_UUID}', true);`);
    }

    if (isValidUuid(branchId)) {
        sessionVars.push(`SELECT set_config('app.current_branch_id', '${branchId}', true);`);
    } else {
        sessionVars.push(`SELECT set_config('app.current_branch_id', '${NIL_UUID}', true);`);
    }
    
    // console.log("Debug sessionVars:", sessionVars);
    await client.query(sessionVars.join('\n'));
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const runTransaction = async <T>(callback: (client: any) => Promise<T>) => {
  const userId = await getUserId();
  const client = await pool.connect();
  
  try {
    if (userId) {
        await setupSession(client, userId);
    } else {
        await clearSession(client); // Ensure clean state even for transactions without user
        await client.query('BEGIN');
    }

    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
        await client.query('ROLLBACK');
    } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
    }
    throw err;
  } finally {
    client.release();
  }
};
