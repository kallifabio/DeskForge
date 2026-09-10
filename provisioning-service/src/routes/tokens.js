// routes/tokens.js
//
// Verwaltung der API-Tokens für Automatisierung. Nur mit dem gemeinsamen
// X-API-Key erreichbar (also faktisch nur über einen Admin im Dashboard).
//
//   GET    /tokens        - Liste (ohne Hash/Klartext)
//   POST   /tokens        - neues Token anlegen; Klartext EINMALIG in der Antwort
//   DELETE /tokens/:id    - Token widerrufen

const express = require('express');
const { requireApiKey } = require('../../../shared/apiKeyAuth');
const { createToken, deleteToken, listTokens } = require('../tokens');

function buildRouter({ store, config }) {
  const router = express.Router();
  router.use(requireApiKey(config.provisioningApiKey));

  router.get('/tokens', (_req, res) => {
    res.json(listTokens(store));
  });

  router.post('/tokens', async (req, res) => {
    const { name, username } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name ist erforderlich' });
    }
    const { token, entry } = await createToken(store, {
      name: String(name).trim(),
      username: username ? String(username).trim() : '*',
      createdBy: req.get('X-Actor') || 'admin',
    });
    // token (Klartext) wird NUR hier zurückgegeben und danach nie wieder.
    res.status(201).json({ token, ...entry });
  });

  router.delete('/tokens/:id', async (req, res) => {
    const removed = await deleteToken(store, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Token nicht gefunden' });
    res.json({ status: 'ok' });
  });

  return router;
}

module.exports = { buildRouter };
