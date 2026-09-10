const test = require('node:test');
const assert = require('node:assert/strict');

const REQUIRED_KEYS = [
  'PROVISIONING_API_KEY', 'PROXMOX_BASE_URL', 'PROXMOX_TOKEN_ID', 'PROXMOX_TOKEN_SECRET',
  'PROXMOX_NODE', 'PROXMOX_TEMPLATE_VMID', 'KASM_BASE_URL', 'KASM_API_KEY',
  'KASM_API_KEY_SECRET', 'KASM_ZONE_ID',
];

const VALID_ENV = {
  PROVISIONING_API_KEY: 'x'.repeat(32),
  PROXMOX_BASE_URL: 'https://proxmox.example.local:8006/api2/json',
  PROXMOX_TOKEN_ID: 'test@pve!test',
  PROXMOX_TOKEN_SECRET: 'geheim',
  PROXMOX_NODE: 'pve',
  PROXMOX_TEMPLATE_VMID: '9000',
  KASM_BASE_URL: 'https://kasm.example.local',
  KASM_API_KEY: 'k',
  KASM_API_KEY_SECRET: 's',
  KASM_ZONE_ID: 'zone-1',
};

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  delete require.cache[require.resolve('../src/config')];
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    delete require.cache[require.resolve('../src/config')];
  }
}

test('config wirft eine gesammelte, verständliche Fehlermeldung bei fehlenden Variablen', () => {
  const incomplete = { ...VALID_ENV };
  delete incomplete.PROXMOX_BASE_URL;
  delete incomplete.KASM_ZONE_ID;

  const envPatch = {};
  for (const key of REQUIRED_KEYS) envPatch[key] = incomplete[key];

  withEnv(envPatch, () => {
    assert.throws(
      () => require('../src/config'),
      (err) => {
        assert.match(err.message, /PROXMOX_BASE_URL/);
        assert.match(err.message, /KASM_ZONE_ID/);
        return true;
      }
    );
  });
});

test('config lädt mit vollständigen, gültigen Werten korrekt und setzt sinnvolle Defaults', () => {
  withEnv(VALID_ENV, () => {
    const config = require('../src/config');
    assert.equal(config.port, 4000); // Default
    assert.equal(config.proxmox.templateVmid, 9000);
    assert.equal(config.proxmox.cloneMode, 'full'); // Default
    assert.equal(config.pool.size, 1); // Default
    assert.equal(config.kasm.zoneId, 'zone-1');
  });
});

test('config lehnt eine zu kurze PROVISIONING_API_KEY ab', () => {
  withEnv({ ...VALID_ENV, PROVISIONING_API_KEY: 'zu-kurz' }, () => {
    assert.throws(() => require('../src/config'), /mindestens 16 Zeichen/);
  });
});
