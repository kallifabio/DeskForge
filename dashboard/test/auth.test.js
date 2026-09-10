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

function loadAuthWithEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    process.env[key] = vars[key];
  }
  for (const mod of ['../src/config', '../src/auth']) {
    delete require.cache[require.resolve(mod)];
  }
  try {
    return fn(require('../src/auth'));
  } finally {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    for (const mod of ['../src/config', '../src/auth']) {
      delete require.cache[require.resolve(mod)];
    }
  }
}

function fakeRes() {
  const res = { statusCode: null, body: null, redirectedTo: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.redirect = (url) => { res.redirectedTo = url; return res; };
  return res;
}

test('requireAuth lässt angemeldete Nutzer durch', () => {
  loadAuthWithEnv(VALID_ENV, ({ requireAuth }) => {
    const req = { session: { user: { username: 'alice' } } };
    const res = fakeRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.redirectedTo, null);
  });
});

test('requireAuth leitet nicht angemeldete Nutzer zum Login um', () => {
  loadAuthWithEnv(VALID_ENV, ({ requireAuth }) => {
    const req = { session: {} };
    const res = fakeRes();
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.redirectedTo, '/auth/login');
  });
});

test('requireAdmin lässt Admin-Nutzer durch', () => {
  loadAuthWithEnv(VALID_ENV, ({ requireAdmin }) => {
    const req = { session: { user: { username: 'alice', isAdmin: true } } };
    const res = fakeRes();
    let nextCalled = false;
    requireAdmin(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

test('requireAdmin blockt Nicht-Admin-Nutzer mit 403', () => {
  loadAuthWithEnv(VALID_ENV, ({ requireAdmin }) => {
    const req = { session: { user: { username: 'bob', isAdmin: false } } };
    const res = fakeRes();
    let nextCalled = false;
    requireAdmin(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
});
