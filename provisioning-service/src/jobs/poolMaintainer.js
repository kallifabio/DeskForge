// jobs/poolMaintainer.js
//
// Hält eine konfigurierbare Anzahl bereits gestarteter, aber noch nicht
// zugewiesener VMs vorrätig (POOL_SIZE), damit "Neue VM anfordern" im
// Regelfall nur Sekunden statt mehrerer Minuten dauert. Läuft regelmäßig
// im Hintergrund UND wird nach jeder Entnahme sofort einmal angestoßen,
// um den Pool zeitnah wieder aufzufüllen.

const { createPoolVm } = require('../vmLifecycle');

async function ensurePoolSize({ store, proxmox, mutex, config, logger }) {
  const data = store.read();
  const poolCount = Object.values(data.vms).filter((v) => v.status === 'pool').length;
  // Laufzeit-Override aus dem Dashboard (PATCH /pool) schlägt die .env.
  const target = Number.isInteger(data.settings.poolSizeOverride)
    ? data.settings.poolSizeOverride
    : config.pool.size;
  const deficit = target - poolCount;

  if (deficit <= 0) return;

  logger.info({ deficit, poolSize: target }, 'Fülle VM-Pool auf');
  for (let i = 0; i < deficit; i++) {
    try {
      await createPoolVm({ store, proxmox, mutex, config, logger });
    } catch (err) {
      logger.error({ err: err.message }, 'Anlegen einer Pool-VM fehlgeschlagen');
      break; // nicht in einer Endlosschleife weiter Fehler produzieren
    }
  }
}

function startPoolMaintainer(deps) {
  const run = () => {
    ensurePoolSize(deps).catch((err) => deps.logger.error({ err: err.message }, 'Pool-Wartung fehlgeschlagen'));
  };
  run();
  return setInterval(run, deps.config.pool.checkIntervalMs);
}

module.exports = { ensurePoolSize, startPoolMaintainer };
