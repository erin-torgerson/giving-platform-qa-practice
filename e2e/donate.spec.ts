import { test, expect } from '@playwright/test';

test('a donor can give $25 to Grace Fellowship', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Amount (USD)').fill('25');
  await page.getByLabel('Church').selectOption('church_grace');
  await page.getByRole('button', { name: 'Give now' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Thank you! Your $25.00 gift to Grace Fellowship was received.',
  );
});
