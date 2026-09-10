// logger.js
// Strukturiertes JSON-Logging statt console.log. Log-Rotation übernimmt
// systemd/journald bzw. der Docker-Log-Treiber, siehe docs/SETUP.md.

const pino = require('pino');

module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'dashboard' },
});
