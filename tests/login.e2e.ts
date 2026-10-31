import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';

// Smoke coverage for the login screen: it needs no API server, so it doubles as
// the check that the configured agent model can drive the browser.
describe('login', { tags: ['smoke'] }, () => {
  test('renders the sign-in form', async ({ app, screen, browser }) => {
    await app.open('/login');

    await expect(browser).toHaveURL('/login');
    await expect(screen.getByText('Selamat Datang')).toBeVisible();
    await expect(screen.getByPlaceholder('nama@perusahaan.com')).toBeVisible();
    await expect(screen.getByRole('button', 'Masuk')).toBeEnabled();
  });

  test('the agent reads the screen', async ({ app, agent }) => {
    await app.open('/login');

    await agent.assert(
      'the page is a sign-in form with an Email field, a Password field and a "Masuk" button',
    );
  });

  test('the agent fills the email field', async ({ app, agent, screen }) => {
    await app.open('/login');

    await agent.act('fill the Email field with qa@example.com without submitting the form');
    await expect(screen.getByPlaceholder('nama@perusahaan.com')).toHaveValue('qa@example.com');
  });
});
