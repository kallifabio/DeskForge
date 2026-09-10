const { test, expect } = require('@playwright/test');

// window.confirm() automatisch bestätigen; Dashboard laden.
test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await expect(page.locator('#appLoading')).toBeHidden();
});

// Bereich über die Sidebar öffnen.
async function nav(page, view) {
  await page.locator(`.nav-item[data-nav="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

test('Sidebar: angemeldeter Admin, Live-Verbindung, Navigationspunkte', async ({ page }) => {
  await expect(page.locator('#whoami')).toContainText('admin');
  await expect(page.locator('#whoami')).toContainText('(Admin)');
  await expect(page.locator('#liveDot')).toBeVisible();
  await expect(page.locator('#adminNav')).toBeVisible();
  // Admin startet auf der Übersicht
  await expect(page.locator('section[data-view="overview"]')).toBeVisible();
  await expect(page.locator('section[data-view="users"]')).toBeHidden();
});

test('Sidebar schaltet Bereiche um (nur einer sichtbar)', async ({ page }) => {
  await nav(page, 'vms');
  await expect(page.locator('section[data-view="overview"]')).toBeHidden();
  await expect(page.locator('.nav-item[data-nav="vms"]')).toHaveClass(/active/);
  await nav(page, 'audit');
  await expect(page.locator('section[data-view="vms"]')).toBeHidden();
});

test('Meine Sitzung: laufende VM zeigt Verbinden/Verlängern/Neustart/Beenden', async ({ page }) => {
  await nav(page, 'session');
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

// Hinweis: der dev-server hält den VM-Zustand im Speicher und wird von
// allen Tests geteilt. Der "abbrechen"-Test läuft daher bewusst VOR dem
// "beenden"-Test, der die VM serverseitig entfernt.
test('Meine Sitzung: beenden abbrechen (SweetAlert2) lässt die VM laufen', async ({ page }) => {
  await nav(page, 'session');
  await page.locator('#stopVmBtn').click();
  await expect(page.locator('.swal2-popup')).toBeVisible();
  await page.locator('.swal2-cancel').click();
  await expect(page.locator('.swal2-popup')).toBeHidden();
  await expect(page.locator('#myVmStatus')).toContainText('Läuft');
});

test('Meine Sitzung: beenden -> SweetAlert2-Bestätigung -> "keine VM"', async ({ page }) => {
  await nav(page, 'session');
  await page.locator('#stopVmBtn').click();
  await expect(page.locator('.swal2-popup')).toBeVisible();
  await expect(page.locator('.swal2-title')).toHaveText('Sitzung beenden?');
  await page.locator('.swal2-confirm').click();
  await expect(page.locator('#myVmStatus')).toContainText('keine VM', { timeout: 8000 });
  await expect(page.locator('#requestVmBtn')).toBeVisible();
  await expect(page.locator('#connectBtn')).toBeHidden();
});

test('Meine Sitzung: VM-Typ-Auswahl + Kontingent-Hinweis', async ({ page }) => {
  await nav(page, 'session');
  await expect(page.locator('#templatePick')).toBeVisible();
  await expect(page.locator('#templateSelect option')).toHaveCount(2);
  await expect(page.locator('#quotaHint')).toContainText('Kontingent');
});

test('Meine Sitzung: Sitzung planen legt Eintrag an', async ({ page }) => {
  await nav(page, 'session');
  await page.locator('#scheduleBox summary').click();
  await page.fill('#scheduleWhen', '2099-01-01T09:00');
  await page.click('#scheduleForm button[type="submit"]');
  await expect(page.locator('#scheduleList')).toContainText('pending');
});

test('Übersicht: System-Status, Kapazität, Nutzung, Orphans', async ({ page }) => {
  await nav(page, 'overview');
  await expect(page.locator('#statusList')).toContainText('Proxmox');
  await expect(page.locator('#statusList')).toContainText('Kasm');
  await expect(page.locator('#capacityBox')).toContainText('RAM');
  await expect(page.locator('#capacityBox .capbar')).not.toHaveCount(0);
  await expect(page.locator('#usageBox')).toContainText('Gesamt');
  await expect(page.locator('#usageBox')).toContainText('EUR');
  await page.click('[data-refresh="orphans"]');
  await expect(page.locator('#orphansBox')).toContainText('deskforge-alt-950');
});

test('Audit-Log ist befüllt und admin.connect ist hervorgehoben', async ({ page }) => {
  await nav(page, 'audit');
  await expect(page.locator('#auditTableBody tr')).not.toHaveCount(0);
  const hl = page.locator('#auditTableBody tr.audit-connect');
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).toContainText('admin.connect');
});

test('VMs: Admin kann sich für Wartung mit fremder Sitzung verbinden (Zugriff wird protokolliert)', async ({ page }) => {
  await nav(page, 'vms');
  const link = page.locator('#vmsTableBody a[data-connect-user]').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /kasm\.deskforge\.local/);
  await expect(link).toHaveAttribute('target', '_blank');
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/connect-audit') && r.method() === 'POST'),
    link.click(),
  ]);
  expect(req).toBeTruthy();
});

test('Automatisierung: API-Token anlegen zeigt Klartext einmalig', async ({ page }) => {
  await nav(page, 'automation');
  await page.fill('#tokenName', 'e2e-runner');
  await page.click('#tokenForm button[type="submit"]');
  await expect(page.locator('#tokenReveal')).toBeVisible();
  await expect(page.locator('#tokenRevealValue')).toContainText(/^dfp_/);
  await expect(page.locator('#tokensTableBody')).toContainText('e2e-runner');
  await expect(page.locator('#adminScheduleList')).toContainText('pending');
});

test('Nutzer: Filter, Sortierung, Detail-Panel', async ({ page }) => {
  await nav(page, 'users');
  await expect(page.locator('#usersTableBody tr')).toHaveCount(3);
  await page.fill('[data-filter="users"]', 'bob');
  await expect(page.locator('#usersTableBody tr')).toHaveCount(1);
  await page.fill('[data-filter="users"]', '');
  await page.locator('th[data-sort="uid"]').click();
  await expect(page.locator('th[data-sort="uid"]')).toHaveAttribute('aria-sort', 'ascending');
  await page.locator('[data-user-detail="alice"]').click();
  await expect(page.locator('#userDetail')).toContainText('Alice Achterberg');
  await expect(page.locator('#userDetail')).toContainText('VM 101');
});

test('Farbschema-Umschalter setzt html.theme-light und merkt es sich', async ({ page }) => {
  await page.click('#themeToggle');
  await expect(page.locator('html')).toHaveClass(/theme-light/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/theme-light/);
});

test('Betrieb: Ankündigungsbanner setzen zeigt es oben an', async ({ page }) => {
  await nav(page, 'ops');
  await page.fill('#announceText', 'E2E-Wartungshinweis');
  await page.selectOption('#announceLevel', 'warning');
  await page.click('#announceForm button[type="submit"]');
  await expect(page.locator('#announcementBar')).toBeVisible();
  await expect(page.locator('#announcementText')).toHaveText('E2E-Wartungshinweis');
});

test('Zuletzt gewählter Bereich überlebt einen Reload', async ({ page }) => {
  await nav(page, 'sessions');
  await page.reload();
  await expect(page.locator('#appLoading')).toBeHidden();
  await expect(page.locator('section[data-view="sessions"]')).toBeVisible();
  await expect(page.locator('.nav-item[data-nav="sessions"]')).toHaveClass(/active/);
});
