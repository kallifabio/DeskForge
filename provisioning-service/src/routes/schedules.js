// routes/schedules.js
//
// Geplante VM-Anforderungen ("morgen 9 Uhr eine VM"). Persistiert in
// state.json (schedules[]); der Job src/jobs/scheduleRunner.js arbeitet
// fällige Einträge ab.
//
//   GET    /schedules            - alle (Admin) bzw. eigene (Token)
//   GET    /schedules/:username  - Einträge eines Nutzers
//   POST   /schedules            - { username, template?, notBefore(ISO) }
//   DELETE /schedules/:id        - stornieren (nur solange "pending")

const express = require('express');
const crypto = require('crypto');
const { requireApiKeyOrToken } = require('../tokens');
const { auditEntry } = require('../../../shared/apiSchema');

function buildRouter({ store, config, logger, access }) {
  const router = express.Router();
  router.use(requireApiKeyOrToken(config.provisioningApiKey, store));

  const boundUser = (req) =>
    req.auth.kind === 'token' && req.auth.username !== '*' ? req.auth.username : null;

  router.get('/schedules', (req, res) => {
    const bound = boundUser(req);
    let rows = store.read().schedules;
    if (bound) rows = rows.filter((s) => s.username === bound);
    res.json(rows.slice().sort((a, b) => a.notBefore.localeCompare(b.notBefore)));
  });

  router.get('/schedules/:username', (req, res) => {
    const bound = boundUser(req);
    if (bound && bound !== req.params.username) return res.status(403).json({ error: 'Nur eigene Einträge' });
    const rows = store.read().schedules.filter((s) => s.username === req.params.username);
    res.json(rows.sort((a, b) => a.notBefore.localeCompare(b.notBefore)));
  });

  router.post('/schedules', async (req, res) => {
    let { username, template, notBefore } = req.body || {};
    const bound = boundUser(req);
    if (bound) username = bound;
    if (!username) return res.status(400).json({ error: 'username fehlt' });

    const when = Date.parse(notBefore);
    if (!when || Number.isNaN(when)) {
      return res.status(400).json({ error: 'notBefore muss ein gültiger ISO-Zeitpunkt sein' });
    }
    if (when < Date.now() - 60_000) {
      return res.status(400).json({ error: 'notBefore liegt in der Vergangenheit' });
    }
    template = template || access.defaultTemplate();
    if (!access.templateExists(template)) {
      return res.status(400).json({ error: `Unbekanntes VM-Template "${template}"` });
    }

    const entry = {
      id: crypto.randomUUID(),
      username,
      template,
      notBefore: new Date(when).toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: req.get('X-Actor') || (req.auth.kind === 'token' ? `token:${req.auth.tokenId}` : 'admin'),
      result: null,
      error: null,
    };
    await store.update((d) => { d.schedules.push(entry); });
    await store.appendAudit(auditEntry({ action: 'schedule.create', actor: entry.createdBy, username, detail: `${template} @ ${entry.notBefore}` }));
    res.status(201).json(entry);
  });

  router.delete('/schedules/:id', async (req, res) => {
    const bound = boundUser(req);
    const target = store.read().schedules.find((s) => s.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Nicht gefunden' });
    if (bound && target.username !== bound) return res.status(403).json({ error: 'Nur eigene Einträge' });
    if (target.status !== 'pending') return res.status(409).json({ error: `Status "${target.status}" - nicht mehr stornierbar` });

    await store.update((d) => {
      const s = d.schedules.find((x) => x.id === req.params.id);
      if (s) s.status = 'cancelled';
    });
    await store.appendAudit(auditEntry({ action: 'schedule.cancel', actor: req.get('X-Actor') || 'admin', username: target.username }));
    res.json({ status: 'ok' });
  });

  return router;
}

module.exports = { buildRouter };
