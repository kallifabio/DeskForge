// tokens.js
//
// Langlebige API-Tokens für Automatisierung (CI/Skripte), damit diese
// eine VM anfordern/abbauen können, ohne den gemeinsamen
// PROVISIONING_API_KEY zu kennen.
//
// Ein Token ist an einen festen Nutzernamen gebunden ("username") oder
// per "*" für beliebige Nutzer. Gespeichert wird nur der SHA-256-Hash;
// der Klartext wird einmalig bei der Erstellung zurückgegeben.

const crypto = require('crypto');

const PREFIX = 'dfp_';

function generateToken() {
  return PREFIX + crypto.randomBytes(24).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// Öffentliche Sicht (ohne Hash) für die Admin-Liste im Dashboard.
function publicView(entry) {
  return {
    id: entry.id,
    name: entry.name,
    username: entry.username,
    tokenPrefix: entry.tokenPrefix,
    createdAt: entry.createdAt,
    createdBy: entry.createdBy,
    lastUsedAt: entry.lastUsedAt || null,
  };
}

async function createToken(store, { name, username, createdBy }) {
  const raw = generateToken();
  const entry = {
    id: crypto.randomUUID(),
    name: String(name || 'unbenannt').slice(0, 80),
    username: username && username !== '*' ? String(username) : '*',
    tokenPrefix: raw.slice(0, PREFIX.length + 6),
    hash: hashToken(raw),
    createdAt: new Date().toISOString(),
    createdBy: createdBy || 'admin',
    lastUsedAt: null,
  };
  await store.update((d) => {
    if (!Array.isArray(d.apiTokens)) d.apiTokens = [];
    d.apiTokens.push(entry);
  });
  return { token: raw, entry: publicView(entry) };
}

async function deleteToken(store, id) {
  let removed = false;
  await store.update((d) => {
    const before = (d.apiTokens || []).length;
    d.apiTokens = (d.apiTokens || []).filter((t) => t.id !== id);
    removed = d.apiTokens.length < before;
  });
  return removed;
}

function listTokens(store) {
  return (store.read().apiTokens || []).map(publicView);
}

// Sucht ein Token per Klartext und aktualisiert lastUsedAt (best effort).
function findByRaw(store, raw) {
  if (!raw || !String(raw).startsWith(PREFIX)) return null;
  const hash = hashToken(raw);
  const entry = (store.read().apiTokens || []).find((t) => t.hash === hash);
  if (!entry) return null;
  store
    .update((d) => {
      const t = (d.apiTokens || []).find((x) => x.id === entry.id);
      if (t) t.lastUsedAt = new Date().toISOString();
    })
    .catch(() => {});
  return entry;
}

// Middleware: akzeptiert entweder den gemeinsamen X-API-Key (voller
// Admin-Zugriff) ODER "Authorization: Bearer <token>" (an einen Nutzer
// gebundener, eingeschränkter Zugriff). Setzt req.auth.
function requireApiKeyOrToken(expectedKey, store) {
  return (req, res, next) => {
    if (!expectedKey) {
      return res.status(500).json({ error: 'PROVISIONING_API_KEY ist serverseitig nicht konfiguriert' });
    }
    const apiKey = req.header('X-API-Key');
    if (apiKey && apiKey === expectedKey) {
      req.auth = { kind: 'admin' };
      return next();
    }
    const bearer = (req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (bearer) {
      const entry = findByRaw(store, bearer);
      if (entry) {
        req.auth = { kind: 'token', tokenId: entry.id, username: entry.username };
        return next();
      }
    }
    return res.status(401).json({ error: 'Ungültiger oder fehlender API-Key / Token' });
  };
}

module.exports = {
  PREFIX,
  generateToken,
  hashToken,
  createToken,
  deleteToken,
  listTokens,
  findByRaw,
  requireApiKeyOrToken,
  publicView,
};
