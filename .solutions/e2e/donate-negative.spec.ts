import { test, expect } from '@playwright/test';

test.describe('donation form — negative paths', () => {
  test('a zero amount shows an error and no thank-you', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Amount (USD)').fill('0');
    await page.getByRole('button', { name: 'Give now' }).click();

    const status = page.getByRole('status');
    await expect(status).toHaveAttribute('data-state', 'error');
    await expect(status).toContainText('Please enter an amount greater than $0.');
    await expect(status).not.toContainText('Thank you');
    await expect(page.getByRole('button', { name: 'Give now' })).toBeEnabled();
  });

  test('an empty amount is rejected too', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Give now' }).click();

    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'error');
  });

  test('a negative amount is rejected and the form keeps the value for correction', async ({ page }) => {
    await page.goto('/');

    const amount = page.getByLabel('Amount (USD)');
    await amount.fill('-5');
    await page.getByRole('button', { name: 'Give now' }).click();

    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'error');
    await expect(amount).toHaveValue('-5');
  });

  test('the API itself rejects a bad amount with 400', async ({ request }) => {
    const response = await request.post('/api/donations', {
      data: { amount: 0, currency: 'USD', churchId: 'church_grace', donorId: 'donor_e2e' },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_AMOUNT');
  });
});
