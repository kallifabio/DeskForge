// logger.js
// Strukturiertes JSON-Logging statt console.log. Die Ausgabe geht nach
// stdout - Log-Rotation übernimmt systemd/journald (bei Betrieb als
// systemd-Dienst, siehe docs/SETUP.md) bzw. der Docker-Log-Treiber (bei
// Betrieb im Container), nicht die Anwendung selbst.

const pino = require('pino');

module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'provisioning-service' },
});
