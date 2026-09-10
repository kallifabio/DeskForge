const { test, expect } = require('@playwright/test');

// Alle window.confirm()-Dialoge automatisch bestätigen.
test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await expect(page.locator('#appLoading')).toBeHidden();
});

test('Kopfzeile: angemeldeter Admin + Live-Verbindung (SSE)', async ({ page }) => {
  await expect(page.locator('#whoami')).toContainText('admin');
  await expect(page.locator('#whoami')).toContainText('(Admin)');
  await expect(page.locator('#liveDot')).toBeVisible();
});

test('Selbstbedienung: laufende VM zeigt Verbinden/Verlängern/Neustart/Beenden', async ({ page }) => {
  await expect(page.locator('#myVmStatus')).toContainText('Läuft');
  const connect = page.locator('#connectBtn');
  await expect(connect).toBeVisible();
  await expect(connect).toHaveAttribute('href', /kasm\.deskforge\.local/);
  await expect(page.locator('#extendBtn')).toBeVisible();
  await expect(page.locator('#rebootBtn')).toBeVisible();
  await expect(page.locator('#stopVmBtn')).toBeVisible();
  await expect(page.locator('#requestVmBtn')).toBeHidden();
  await expect(page.locator('#idleInfo')).toContainText('Automatischer Abbau');
});

test('Selbstbedienung: Sitzung beenden -> "keine VM" + VM anfordern', async ({ page }) => {
  await page.locator('#stopVmBtn').click();
  await expect(page.locator('#myVmStatus')).toContainText('keine VM', { timeout: 8000 });
  await expect(page.locator('#requestVmBtn')).toBeVisible();
  await expect(page.locator('#connectBtn')).toBeHidden();
});

test('VM-Typ-Auswahl + Kontingent-Hinweis', async ({ page }) => {
  await expect(page.locator('#templatePick')).toBeVisible();
  await expect(page.locator('#templateSelect option')).toHaveCount(2);
  await expect(page.locator('#quotaHint')).toContainText('Kontingent');
});

test('Admin: System-Status und Host-Kapazität', async ({ page }) => {
  await expect(page.locator('#statusList')).toContainText('Proxmox');
  await expect(page.locator('#statusList')).toContainText('Kasm');
  await expect(page.locator('#capacityBox')).toContainText('RAM');
  await expect(page.locator('#capacityBox .capbar')).not.toHaveCount(0);
});

test('Admin: Audit-Log und Nutzungsansicht befüllt', async ({ page }) => {
  await expect(page.locator('#auditTableBody tr')).not.toHaveCount(0);
  await expect(page.locator('#usageBox')).toContainText('Gesamt');
  await expect(page.locator('#usageBox')).toContainText('EUR');
});

test('Admin: API-Token anlegen zeigt Klartext einmalig', async ({ page }) => {
  await page.fill('#tokenName', 'e2e-runner');
  await page.click('#tokenForm button[type="submit"]');
  await expect(page.locator('#tokenReveal')).toBeVisible();
  await expect(page.locator('#tokenRevealValue')).toContainText(/^dfp_/);
  await expect(page.locator('#tokensTableBody')).toContainText('e2e-runner');
});

test('Selbstbedienung: Sitzung planen legt Eintrag an', async ({ page }) => {
  await page.locator('#scheduleBox summary').click();
  await page.fill('#scheduleWhen', '2099-01-01T09:00');
  await page.click('#scheduleForm button[type="submit"]');
  await expect(page.locator('#scheduleList')).toContainText('pending');
});

test('Admin: Verwaiste Ressourcen prüfen', async ({ page }) => {
  await page.click('[data-refresh="orphans"]');
  await expect(page.locator('#orphansBox')).toContainText('deskforge-alt-950');
});

test('Admin: Nutzer-Filter und Sortierung', async ({ page }) => {
  await expect(page.locator('#usersTableBody tr')).toHaveCount(3);
  await page.fill('[data-filter="users"]', 'bob');
  await expect(page.locator('#usersTableBody tr')).toHaveCount(1);
  await page.fill('[data-filter="users"]', '');
  await page.locator('th[data-sort="uid"]').click();
  await expect(page.locator('th[data-sort="uid"]')).toHaveAttribute('aria-sort', 'ascending');
});

test('Admin: Nutzer-Detail per Klick auf die ID', async ({ page }) => {
  await page.locator('[data-user-detail="alice"]').click();
  const detail = page.locator('#userDetail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Alice Achterberg');
  await expect(detail).toContainText('VM 101');
});

test('Farbschema-Umschalter setzt html.theme-light und merkt es sich', async ({ page }) => {
  await page.click('#themeToggle');
  await expect(page.locator('html')).toHaveClass(/theme-light/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/theme-light/);
});

test('Admin: Ankündigungsbanner setzen zeigt es oben an', async ({ page }) => {
  await page.fill('#announceText', 'E2E-Wartungshinweis');
  await page.selectOption('#announceLevel', 'warning');
  await page.click('#announceForm button[type="submit"]');
  await expect(page.locator('#announcementBar')).toBeVisible();
  await expect(page.locator('#announcementText')).toHaveText('E2E-Wartungshinweis');
});
