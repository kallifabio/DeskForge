// vmLifecycle.js
//
// Kernlogik rund um den Lebenszyklus einer VM: VMID race-condition-frei
// vergeben, neue VMs klonen (für den Pool oder als Sofort-Fallback), bei
// Kasm registrieren/deregistrieren und wieder abbauen. Wird sowohl von
// den HTTP-Routen als auch von den Hintergrund-Jobs (Pool-Wartung,
// Idle-Reaper) genutzt, damit dieselbe Logik nicht zweimal existiert.

// Vergibt eine VMID und stößt das Klonen an - NUR dieser kurze Abschnitt
// läuft unter dem Mutex, damit zwei gleichzeitige Anfragen nicht dieselbe
// VMID bekommen. Das eigentliche (mehrminütige) Warten auf den
// Klon-Abschluss passiert danach außerhalb der Sperre, damit currently
// laufende Klon-Vorgänge andere Anfragen nicht blockieren.
async function allocateAndCloneVm({ proxmox, mutex, config, name }) {
  const release = await mutex.acquire();
  let vmid;
  let upid;
  try {
    vmid = await proxmox.getNextVmid();
    upid = await proxmox.submitClone({
      templateVmid: config.proxmox.templateVmid,
      newVmid: vmid,
      name,
      linked: config.proxmox.cloneMode === 'linked',
    });
  } finally {
    release();
  }
  await proxmox.waitForTask(upid);
  return vmid;
}

// Erzeugt eine fertig gebootete, aber noch NICHT bei Kasm registrierte VM
// und legt sie mit Status "pool" im State Store ab.
async function createPoolVm({ store, proxmox, mutex, config, logger }) {
  const vmid = await allocateAndCloneVm({ proxmox, mutex, config, name: `deskforge-pool-${Date.now()}` });
  logger.info({ vmid }, 'Pool-VM geklont, starte sie');

  await proxmox.startVm(vmid);
  await proxmox.waitForGuestAgent(vmid);
  const ip = await proxmox.getGuestIpAddress(vmid);

  await store.update((data) => {
    data.vms[vmid] = {
      vmid,
      name: `deskforge-pool-${vmid}`,
      status: 'pool',
      username: null,
      kasmServerId: null,
      ip,
      createdAt: new Date().toISOString(),
      assignedAt: null,
      lastActiveCheck: null,
    };
  });

  logger.info({ vmid, ip }, 'Pool-VM bereit');
  return vmid;
}

// Registriert eine (aus dem Pool entnommene oder frisch geklonte) VM bei
// Kasm und markiert sie im State Store als "assigned".
async function assignVmToUser({ store, proxmox, kasm, config, logger, vmid, username }) {
  const data = store.read();
  const vm = data.vms[vmid];
  if (!vm) throw new Error(`VM ${vmid} nicht im Bestand gefunden`);

  const kasmName = `deskforge-${username}-${vmid}`.toLowerCase();
  logger.info({ vmid, username }, 'Registriere VM bei Kasm');
  const serverId = await kasm.createServer({ name: kasmName, ip: vm.ip, zoneId: config.kasm.zoneId });
  const registrationToken = await kasm.getServerRegistrationToken(serverId);

  logger.info({ vmid }, 'Führe Registrierungsskript auf der VM aus');
  const pid = await proxmox.execInGuest(vmid, [
    'powershell.exe',
    '-ExecutionPolicy', 'Bypass',
    '-File', config.windowsAgentScriptPath,
    '-KasmHostname', new URL(config.kasm.baseUrl).hostname,
    '-RegistrationToken', registrationToken,
  ]);
  const execResult = await proxmox.waitForExec(vmid, pid);
  if (execResult['exit-code'] !== 0) {
    throw new Error(
      `register-vm.ps1 endete mit Exit-Code ${execResult['exit-code']}. ` +
      `stderr (base64): ${execResult['err-data'] || '(leer)'}`
    );
  }

  await store.update((d) => {
    d.vms[vmid] = {
      ...d.vms[vmid],
      status: 'assigned',
      username,
      kasmServerId: serverId,
      assignedAt: new Date().toISOString(),
      lastActiveCheck: new Date().toISOString(),
    };
  });

  return { vmid, ip: vm.ip, kasmServerId: serverId };
}

// Baut eine VM vollständig ab: bei Kasm deregistrieren, in Proxmox
// stoppen und löschen, aus dem State Store entfernen. Wird sowohl vom
// "/deprovision"-Endpunkt als auch vom Idle-Reaper genutzt.
async function deprovisionVm({ store, proxmox, kasm, logger, vmid }) {
  const data = store.read();
  const vm = data.vms[vmid];
  if (!vm) {
    throw new Error(`VM ${vmid} nicht im Bestand gefunden`);
  }

  await store.update((d) => {
    if (d.vms[vmid]) d.vms[vmid].status = 'deprovisioning';
  });

  if (vm.kasmServerId) {
    try {
      await kasm.deleteServer(vm.kasmServerId);
    } catch (err) {
      logger.warn({ vmid, err: err.message }, 'Kasm-Server konnte nicht gelöscht werden (ggf. bereits entfernt)');
    }
  }

  try {
    await proxmox.stopVm(vmid);
  } catch (err) {
    logger.warn({ vmid, err: err.message }, 'VM konnte nicht sauber gestoppt werden (ggf. bereits gestoppt)');
  }

  await proxmox.deleteVm(vmid);

  await store.update((d) => {
    delete d.vms[vmid];
  });

  logger.info({ vmid }, 'VM vollständig abgebaut');
}

module.exports = { allocateAndCloneVm, createPoolVm, assignVmToUser, deprovisionVm };
