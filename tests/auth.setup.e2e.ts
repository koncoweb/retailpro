import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { ACCOUNTS, signIn } from './support/accounts';

/**
 * One sign-in per role, saved as a session so every other test starts on the
 * screen it covers instead of on the login form.
 *
 * The roster comes from `npm run e2e:users`; sign-in goes through the real
 * Better Auth endpoint (`/api/auth/sign-in/email`), so a broken password or a
 * missing tenant registration fails here, once, with a clear message.
 */
for (const account of ACCOUNTS) {
  test.setup(`sign in as the ${account.label}`, { sessions: [account.session] }, async ({ app, screen, session, browser }) => {
    const credential = signIn(account.session);

    await app.open('/login');
    await screen.getByLabel('Email').fill(credential.username);
    await screen.getByLabel('Password').fill(credential.password);
    await screen.getByRole('button', 'Masuk').tap();

    // A signed-in account always lands on the mode chooser; the tenant database
    // is resolved (and its token minted) before the redirect.
    await expect(browser).toHaveURL('/mode-select');
    await expect(screen.getByText('Pilih mode yang ingin Anda gunakan')).toBeVisible();

    await session.save(account.session);
  });
}
