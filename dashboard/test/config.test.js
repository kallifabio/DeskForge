const test = require('node:test');
const assert = require('node:assert/strict');

const VALID_ENV = {
  SESSION_SECRET: 'x'.repeat(20),
  AUTHENTIK_ISSUER_URL: 'https://authentik.example.local/application/o/vdi/',
  AUTHENTIK_CLIENT_ID: 'client-id',
  AUTHENTIK_CLIENT_SECRET: 'client-secret',
  AUTHENTIK_REDIRECT_URI: 'http://localhost:5000/auth/callback',
  LDAP_URL: 'ldap://openldap:389',
  LDAP_BIND_DN: 'cn=admin,dc=deskforge,dc=local',
  LDAP_BIND_PASSWORD: 'geheim',
  LDAP_BASE_DN: 'dc=deskforge,dc=local',
  PROVISIONING_SERVICE_URL: 'http://provisioning-service:4000',
  PROVISIONING_API_KEY: 'x'.repeat(32),
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

test('config wirft eine gesammelte Fehlermeldung bei fehlenden Variablen', () => {
  const incomplete = { ...VALID_ENV };
  delete incomplete.AUTHENTIK_CLIENT_SECRET;
  delete incomplete.PROVISIONING_API_KEY;

  withEnv(incomplete, () => {
    assert.throws(
      () => require('../src/config'),
      (err) => {
        assert.match(err.message, /AUTHENTIK_CLIENT_SECRET/);
        assert.match(err.message, /PROVISIONING_API_KEY/);
        return true;
      }
    );
  });
});

test('config lädt mit vollständigen Werten und setzt AUTHENTIK_ADMIN_GROUP-Default', () => {
  withEnv(VALID_ENV, () => {
    const config = require('../src/config');
    assert.equal(config.authentik.adminGroup, 'deskforge-admins');
    assert.equal(config.port, 5000);
    assert.equal(config.provisioning.url, 'http://provisioning-service:4000');
  });
});

test('config übernimmt einen eigenen AUTHENTIK_ADMIN_GROUP-Wert', () => {
  withEnv({ ...VALID_ENV, AUTHENTIK_ADMIN_GROUP: 'it-team' }, () => {
    const config = require('../src/config');
    assert.equal(config.authentik.adminGroup, 'it-team');
  });
});
