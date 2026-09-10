// routes/vms.js
//
// Read-only Auskunft über den aktuellen VM-Bestand für das Dashboard.
// Der Provisioning-Service ist jetzt die einzige Stelle, die Proxmox-
// und Kasm-Zugangsdaten kennt - das Dashboard fragt nur noch hier nach,
// statt selbst eigene Proxmox-/Kasm-Clients zu pflegen (vorher doppelter
// Code an zwei Stellen).

const express = require('express');
const { requireApiKey } = require('../../../shared/apiKeyAuth');

function buildRouter({ store, config }) {
  const router = express.Router();
  router.use(requireApiKey(config.provisioningApiKey));

  // Alle zugewiesenen VMs (für die Admin-Ansicht im Dashboard).
  router.get('/vms', (_req, res) => {
    const data = store.read();
    const assigned = Object.values(data.vms).filter((v) => v.status === 'assigned');
    res.json(assigned);
  });

  // Die VM eines einzelnen Nutzers (für die Selbstbedienungs-Ansicht).
  router.get('/vms/:username', (req, res) => {
    const data = store.read();
    const vm = Object.values(data.vms).find((v) => v.username === req.params.username && v.status === 'assigned');
    if (!vm) {
      return res.status(404).json({ error: 'Keine zugewiesene VM für diesen Nutzer' });
    }
    res.json(vm);
  });

  return router;
}

module.exports = { buildRouter };
