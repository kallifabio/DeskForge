const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VALID_ENV = {
  PORT: '0',
  PROVISIONING_API_KEY: 'x'.repeat(32),
  // Absichtlich nicht auflösbare Hosts - Tests hier rühren nur Routen an,
  // die vor jedem echten Proxmox-/Kasm-Aufruf bereits validieren oder
  // ablehnen, damit kein echter Netzwerkzugriff nötig ist.
  PROXMOX_BASE_URL: 'https://proxmox.invalid.example:8006/api2/json',
  PROXMOX_TOKEN_ID: 'test@pve!test',
  PROXMOX_TOKEN_SECRET: 'geheim',
  PROXMOX_NODE: 'pve',
  PROXMOX_TEMPLATE_VMID: '9000',
  KASM_BASE_URL: 'https://kasm.invalid.example',
  KASM_API_KEY: 'k',
  KASM_API_KEY_SECRET: 's',
  KASM_ZONE_ID: 'zone-1',
  POOL_SIZE: '0',
};

function withServer(fn) {
  return async () => {
    const original = {};
    for (const key of Object.keys(VALID_ENV)) {
      original[key] = process.env[key];
      process.env[key] = VALID_ENV[key];
    }
    process.env.STATE_FILE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vdi-state-')), 'state.json');

    for (const mod of ['../src/config', '../src/server']) {
      delete require.cache[require.resolve(mod)];
    }

    const { createApp } = require('../src/server');
    const { app, poolInterval, idleInterval } = createApp();
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      await fn({ baseUrl });
    } finally {
      clearInterval(poolInterval);
      clearInterval(idleInterval);
      await new Promise((resolve) => server.close(resolve));
      for (const key of Object.keys(VALID_ENV)) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  };
}

test('GET /health ist ohne API-Key erreichbar', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
}));

test('POST /provision ohne API-Key wird abgelehnt', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice' }),
  });
  assert.equal(res.status, 401);
}));

test('POST /provision mit falschem API-Key wird abgelehnt', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'falscher-key' },
    body: JSON.stringify({ username: 'alice' }),
  });
  assert.equal(res.status, 401);
}));

test('POST /provision mit gültigem API-Key aber ohne username liefert 400', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': VALID_ENV.PROVISIONING_API_KEY },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
}));

test('POST /deprovision für unbekannte vmid liefert 500 mit klarer Fehlermeldung', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/deprovision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': VALID_ENV.PROVISIONING_API_KEY },
    body: JSON.stringify({ vmid: 99999 }),
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /nicht im Bestand gefunden/);
}));

test('GET /vms/:username für unbekannten Nutzer liefert 404', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/vms/unbekannt`, {
    headers: { 'X-API-Key': VALID_ENV.PROVISIONING_API_KEY },
  });
  assert.equal(res.status, 404);
}));

test('GET /vms ohne API-Key wird abgelehnt', withServer(async ({ baseUrl }) => {
  const res = await fetch(`${baseUrl}/vms`);
  assert.equal(res.status, 401);
}));
