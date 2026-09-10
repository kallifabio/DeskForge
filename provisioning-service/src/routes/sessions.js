// routes/sessions.js
// Durchreiche der aktiven Kasm-Sitzungen für die Admin-Ansicht im
// Dashboard (das Dashboard selbst hat keine Kasm-Zugangsdaten mehr).

const express = require('express');
const { requireApiKey } = require('../../../shared/apiKeyAuth');

function buildRouter({ kasm, config }) {
  const router = express.Router();
  router.use(requireApiKey(config.provisioningApiKey));

  router.get('/sessions', async (_req, res) => {
    try {
      res.json(await kasm.getSessions());
    } catch (err) {
      res.status(502).json({ error: `Kasm-Abfrage fehlgeschlagen: ${err.message}` });
    }
  });

  return router;
}

module.exports = { buildRouter };
