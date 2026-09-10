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
const { loadAccess } = require('./access');
const { buildRouter: buildProvisionRouter } = require('./routes/provision');
const { buildRouter: buildVmsRouter } = require('./routes/vms');
const { buildRouter: buildSessionsRouter } = require('./routes/sessions');
const { buildRouter: buildTokensRouter } = require('./routes/tokens');
const { buildRouter: buildSchedulesRouter } = require('./routes/schedules');
const { startPoolMaintainer } = require('./jobs/poolMaintainer');
const { startIdleReaper } = require('./jobs/idleReaper');
const { startScheduleRunner } = require('./jobs/scheduleRunner');

function createApp() {
  const store = new StateStore(config.stateFilePath, logger);
  const proxmox = buildProxmoxClient(config);
  const kasm = buildKasmClient(config);
  const mutex = new Mutex();
  const access = loadAccess(config.accessFilePath, config, logger);
  logger.info(
    { templates: access.templateNames, fromFile: access.fromFile },
    'Zugriffs-/Template-Konfiguration geladen'
  );

  const app = express();
  app.use(express.json());

  // Unauthentifiziert, für Monitoring (siehe docs/MONITORING.md).
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(buildProvisionRouter({ store, proxmox, kasm, mutex, config, logger, access }));
  app.use(buildVmsRouter({ store, proxmox, kasm, config, logger, access }));
  app.use(buildSessionsRouter({ kasm, config, logger }));
  app.use(buildTokensRouter({ store, config }));
  app.use(buildSchedulesRouter({ store, config, logger, access }));

  const poolInterval = startPoolMaintainer({ store, proxmox, mutex, config, logger });
  const idleInterval = startIdleReaper({ store, proxmox, kasm, config, logger });
  const scheduleInterval = startScheduleRunner({ store, config, logger });

  return { app, poolInterval, idleInterval, scheduleInterval };
}

if (require.main === module) {
  const { app } = createApp();
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Provisioning-Service läuft');
  });
}

module.exports = { createApp };
