// jobs/idleReaper.js
//
// Baut zugewiesene VMs automatisch ab, wenn ihre Kasm-Sitzung seit
// IDLE_TIMEOUT_MINUTES nicht mehr aktiv ist. Verhindert, dass angeforderte
// VMs für immer weiterlaufen und Ressourcen blockieren, wenn niemand sie
// wieder manuell beendet.
//
// WICHTIG: Die Felder in der Kasm-"get_kasms"-Antwort (operational_status
// vs. status, server_id-Zuordnung) können je nach Kasm-Version leicht
// abweichen. Im Zweifelsfall lieber zu selten als zu häufig abbauen -
// deshalb wird bei einem Fehler beim Abfragen der Sitzungen die VM
// sicherheitshalber als "noch aktiv" behandelt (siehe isSessionActive).

const { deprovisionVm } = require('../vmLifecycle');

async function isSessionActive({ kasm, vm, logger }) {
  if (!vm.kasmServerId) return false;
  try {
    const sessions = await kasm.getSessions();
    return sessions.some((s) => {
      const belongsToThisServer = s.server_id === vm.kasmServerId;
      const statusText = (s.operational_status || s.status || '').toLowerCase();
      return belongsToThisServer && (statusText === 'running' || statusText === 'starting');
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Konnte Kasm-Sitzungen nicht abfragen - VM wird sicherheitshalber als aktiv behandelt');
    return true;
  }
}

async function reapIdleVms({ store, proxmox, kasm, config, logger }) {
  const data = store.read();
  const now = Date.now();

  for (const vm of Object.values(data.vms)) {
    if (vm.status !== 'assigned') continue;

    // Nutzer hat "Sitzung verlängern" gedrückt - bis dahin nicht abbauen.
    if (vm.keepaliveUntil && new Date(vm.keepaliveUntil).getTime() > now) continue;

    const active = await isSessionActive({ kasm, vm, logger });
    if (active) {
      await store.update((d) => {
        if (d.vms[vm.vmid]) d.vms[vm.vmid].lastActiveCheck = new Date().toISOString();
      });
      continue;
    }

    const referenceIso = vm.lastActiveCheck || vm.assignedAt;
    const idleMinutes = (now - new Date(referenceIso).getTime()) / 60000;

    if (idleMinutes >= config.idle.timeoutMinutes) {
      logger.info({ vmid: vm.vmid, idleMinutes: Math.round(idleMinutes) }, 'VM ist im Leerlauf, wird abgebaut');
      try {
        await deprovisionVm({ store, proxmox, kasm, logger, vmid: vm.vmid, actor: 'system:idle' });
      } catch (err) {
        logger.error({ vmid: vm.vmid, err: err.message }, 'Automatischer Abbau fehlgeschlagen');
      }
    }
  }
}

function startIdleReaper(deps) {
  const run = () => {
    reapIdleVms(deps).catch((err) => deps.logger.error({ err: err.message }, 'Idle-Reaper-Durchlauf fehlgeschlagen'));
  };
  run();
  return setInterval(run, deps.config.idle.checkIntervalMs);
}

module.exports = { reapIdleVms, startIdleReaper, isSessionActive };
