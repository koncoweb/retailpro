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

const getUserId = async (): Promise<string | undefined> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (await authClient.getSession()) as any;
    const uid = session.data?.user?.id || session.data?.session?.userId;
    console.log("Debug getUserId:", { uid, type: typeof uid }); 
    if (typeof uid === 'string' && uid.trim().length > 0) {
      return uid;
    }
    return undefined;
  } catch (e) {
    console.warn("Auth session check failed, proceeding as unauthenticated:", e);
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
       await setupSession(client, userId);
    } else {
       await clearSession(client);
    }
      
    const res = await client.query(text, params);
    
    // Only commit if we started a transaction (which setupSession does)
    if (userId) {
        await client.query('COMMIT');
    }
    return res;
  } catch (err) {
    if (userId) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error("Rollback failed:", rollbackError);
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
        `SELECT set_config('app.current_user_id', NULL, true);`,
        `SELECT set_config('app.current_tenant_id', NULL, true);`,
        `SELECT set_config('app.current_branch_id', NULL, true);`
    ];
    await client.query(sessionVars.join('\n'));
};

const setupSession = async (client: any, userId: string) => {
    // Extra defensive check to prevent invalid UUID syntax error
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
        console.warn("setupSession called with empty userId");
        return;
    }

    await client.query('BEGIN');

    // 1. Set User ID first (needed for RLS on users table)
    // Use set_config for consistency and safety
    await client.query(`SELECT set_config('app.current_user_id', '${userId}', true)`);

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

    if (tenantId && typeof tenantId === 'string' && tenantId.trim().length > 0) {
        sessionVars.push(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
    } else {
        sessionVars.push(`SELECT set_config('app.current_tenant_id', NULL, true);`);
    }

    if (branchId && typeof branchId === 'string' && branchId.trim().length > 0) {
        sessionVars.push(`SELECT set_config('app.current_branch_id', '${branchId}', true);`);
    } else {
        sessionVars.push(`SELECT set_config('app.current_branch_id', NULL, true);`);
    }
    
    console.log("Debug sessionVars:", sessionVars);
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
