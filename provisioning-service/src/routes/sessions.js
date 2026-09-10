// routes/sessions.js
// Aktive Kasm-Sitzungen für die Admin-Ansicht im Dashboard (das
// Dashboard selbst hat keine Kasm-Zugangsdaten mehr) plus das gezielte
// Trennen einer Sitzung, OHNE die zugehörige VM abzubauen.

const express = require('express');
const { requireApiKey } = require('../../../shared/apiKeyAuth');

function buildRouter({ kasm, config, logger }) {
  const router = express.Router();
  router.use(requireApiKey(config.provisioningApiKey));

  router.get('/sessions', async (_req, res) => {
    try {
      res.json(await kasm.getSessions());
    } catch (err) {
      res.status(502).json({ error: `Kasm-Abfrage fehlgeschlagen: ${err.message}` });
    }
  });

  // Sitzung beenden, VM/Server bleiben bestehen (Nutzer kann sich neu
  // verbinden). user_id kann per Body mitgegeben werden, falls die
  // Kasm-Version es verlangt.
  router.post('/sessions/:kasmId/disconnect', async (req, res) => {
    try {
      await kasm.destroySession(req.params.kasmId, req.body && req.body.user_id);
      res.json({ status: 'ok', kasmId: req.params.kasmId });
    } catch (err) {
      if (logger) logger.error({ kasmId: req.params.kasmId, err: err.message }, 'Sitzung trennen fehlgeschlagen');
      res.status(502).json({ error: `Trennen fehlgeschlagen: ${err.message}` });
    }
  });

  return router;
}

module.exports = { buildRouter };
