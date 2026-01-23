import { createAuthClient } from '@neondatabase/neon-js/auth';

// Create the Neon Auth client instance
// VITE_NEON_AUTH_URL should be set in your .env file
// You can find this URL in the Neon Console under the Auth section
export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL || "http://localhost:3000");

// Helper to check if user is authenticated (can be used in protected routes)
export const isAuthenticated = async () => {
    try {
        const session = await authClient.getSession();
        return !!session.data?.session;
    } catch (error) {
        return false;
    }
};

// Helper to get current user role
export const getUserRole = async () => {
    try {
        const session = await authClient.getSession();
        // Assuming role is stored in user metadata or part of the extended schema
        // Note: Better Auth/Neon Auth user object might need type extension
        return (session.data?.user as any)?.role || 'guest';
    } catch (error) {
        return 'guest';
    }
};
