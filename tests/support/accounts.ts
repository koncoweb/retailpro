import { credentials } from 'e2e';

/**
 * The sign-in roster the e2e suites run as.
 *
 * The identities themselves live in `credentials` in `e2e.config.ts`, which is
 * the only place an e2e password may sit: resolving one hands back an opaque
 * `Secret` that only `locator.fill` and `agent.act` params accept, so the value
 * never reaches a log, a screenshot or the model.
 *
 * RetailPro splits identities in two: the login lives in the control-plane
 * database, the staff row in the tenant database. The three staff accounts come
 * from `npm run e2e:users` (scripts/provision-e2e-users.ts); the owner comes
 * from the demo seed.
 */
export interface TestAccount {
  /** Session name saved by tests/auth.setup.e2e.ts and restored with `{ session }`. */
  session: string;
  /** The role as the app labels it, for readable test titles and failures. */
  label: string;
  /** The matching entry under `credentials` in e2e.config.ts. */
  credential: string;
}

export const ACCOUNTS: readonly TestAccount[] = [
  { session: 'owner', label: 'owner', credential: 'owner' },
  { session: 'admin', label: 'tenant admin', credential: 'admin' },
  { session: 'kasir', label: 'cashier', credential: 'kasir' },
  { session: 'gudang', label: 'warehouse staff', credential: 'gudang' },
];

/**
 * The pair the sign-in form takes, for a saved session name: a plain email and
 * a secret password. Throws `AUTH_CREDENTIAL_UNAVAILABLE` when the account is
 * missing from the config, which names the gap better than a failed sign-in.
 */
export function signIn(session: string) {
  const account = ACCOUNTS.find((entry) => entry.session === session);
  if (!account) throw new Error(`No e2e account for session "${session}".`);
  return credentials.user(account.credential);
}
