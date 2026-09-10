// server.js
// Einstiegspunkt des Provisioning-Service: verdrahtet Konfiguration,
// State Store, Proxmox-/Kasm-Clients, HTTP-Routen und Hintergrund-Jobs
// (Pool-Wartung, Idle-Reaper).

const express = require('express');
const config = require('./config');
const logger = require('./logger');
const { StateStore } = require('./state/store');
const { buildProxmoxClient, buildKasmClient } = require('./clients');
const { Mutex } = require('../../shared/mutex');
const { buildRouter: buildProvisionRouter } = require('./routes/provision');
const { buildRouter: buildVmsRouter } = require('./routes/vms');
const { buildRouter: buildSessionsRouter } = require('./routes/sessions');
const { startPoolMaintainer } = require('./jobs/poolMaintainer');
const { startIdleReaper } = require('./jobs/idleReaper');

function createApp() {
  const store = new StateStore(config.stateFilePath, logger);
  const proxmox = buildProxmoxClient(config);
  const kasm = buildKasmClient(config);
  const mutex = new Mutex();

  const app = express();
  app.use(express.json());

  // Unauthentifiziert, für Monitoring (siehe docs/MONITORING.md).
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(buildProvisionRouter({ store, proxmox, kasm, mutex, config, logger }));
  app.use(buildVmsRouter({ store, config }));
  app.use(buildSessionsRouter({ kasm, config }));

  const poolInterval = startPoolMaintainer({ store, proxmox, mutex, config, logger });
  const idleInterval = startIdleReaper({ store, proxmox, kasm, config, logger });

  return { app, poolInterval, idleInterval };
}

if (require.main === module) {
  const { app } = createApp();
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Provisioning-Service läuft');
  });
}

module.exports = { createApp };
