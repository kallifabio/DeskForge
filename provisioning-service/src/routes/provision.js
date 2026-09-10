// routes/provision.js
//
// POST /provision    - liefert eine VM für den angegebenen Nutzer (aus
//                       dem Pool, falls verfügbar, sonst frisch geklont).
//                       Hat der Nutzer bereits eine zugewiesene VM, wird
//                       diese unverändert zurückgegeben (kein Doppel-
//                       Provisioning pro Nutzer).
// POST /deprovision  - baut eine VM wieder ab (per vmid ODER username).
//
// Beide Routen sind über den gemeinsamen API-Key geschützt (siehe
// shared/apiKeyAuth.js) und zusätzlich pro Nutzer ratenbegrenzt, damit ein
// Doppelklick oder mutwilliges Spammen nicht beliebig viele VMs erzeugt.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireApiKey } = require('../../../shared/apiKeyAuth');
const { createPoolVm, allocateAndCloneVm, assignVmToUser, deprovisionVm } = require('../vmLifecycle');
const { ensurePoolSize } = require('../jobs/poolMaintainer');

function findExistingAssignment(store, username) {
  const data = store.read();
  return Object.values(data.vms).find((v) => v.username === username && v.status === 'assigned');
}

function findFreePoolVm(store) {
  const data = store.read();
  return Object.values(data.vms).find((v) => v.status === 'pool');
}

function buildRouter({ store, proxmox, kasm, mutex, config, logger }) {
  const router = express.Router();

  const provisionLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 3,
    keyGenerator: (req) => req.body?.username || req.ip,
    message: { error: 'Zu viele Provisioning-Anfragen für diesen Nutzer - bitte kurz warten.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.use(requireApiKey(config.provisioningApiKey));

  router.post('/provision', provisionLimiter, async (req, res) => {
    const { username } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: 'username fehlt im Request-Body' });
    }

    const existing = findExistingAssignment(store, username);
    if (existing) {
      logger.info({ username, vmid: existing.vmid }, 'Nutzer hat bereits eine zugewiesene VM, gebe diese zurück');
      return res.json({ status: 'ok', reused: true, vmid: existing.vmid, ip: existing.ip, kasmServerId: existing.kasmServerId });
    }

    let vmid;
    try {
      const release = await mutex.acquire();
      let poolVm;
      try {
        poolVm = findFreePoolVm(store);
        if (poolVm) {
          await store.update((d) => { d.vms[poolVm.vmid].status = 'claiming'; });
        }
      } finally {
        release();
      }

      if (poolVm) {
        vmid = poolVm.vmid;
        logger.info({ vmid, username }, 'Weise Pool-VM zu');
      } else {
        logger.info({ username }, 'Kein Pool-VM frei, klone eine frische VM (dauert länger)');
        vmid = await allocateAndCloneVm({ proxmox, mutex, config, name: `deskforge-${username}-${Date.now()}`.toLowerCase() });
        await proxmox.startVm(vmid);
        await proxmox.waitForGuestAgent(vmid);
        const ip = await proxmox.getGuestIpAddress(vmid);
        await store.update((d) => {
          d.vms[vmid] = {
            vmid, name: `deskforge-${username}-${vmid}`, status: 'claiming', username: null,
            kasmServerId: null, ip, createdAt: new Date().toISOString(), assignedAt: null, lastActiveCheck: null,
          };
        });
      }

      const result = await assignVmToUser({
        store, proxmox, kasm, config, logger, vmid, username,
        actor: req.get('X-Actor') || username,
      });

      res.json({ status: 'ok', reused: false, ...result });

      // Pool im Hintergrund wieder auffüllen - blockiert die Antwort an
      // den Nutzer nicht.
      ensurePoolSize({ store, proxmox, mutex, config, logger }).catch((err) =>
        logger.error({ err: err.message }, 'Pool-Auffüllung nach Zuweisung fehlgeschlagen')
      );
    } catch (err) {
      logger.error({ username, err: err.message }, 'Provisioning fehlgeschlagen');
      if (vmid) {
        deprovisionVm({ store, proxmox, kasm, logger, vmid }).catch((cleanupErr) =>
          logger.error({ vmid, err: cleanupErr.message }, 'Aufräumen nach Fehler fehlgeschlagen')
        );
      }
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  router.post('/deprovision', async (req, res) => {
    const { vmid, username } = req.body || {};
    let targetVmid = vmid;

    if (!targetVmid && username) {
      const existing = findExistingAssignment(store, username);
      if (!existing) {
        return res.status(404).json({ error: `Keine zugewiesene VM für Nutzer '${username}' gefunden` });
      }
      targetVmid = existing.vmid;
    }

    if (!targetVmid) {
      return res.status(400).json({ error: 'vmid oder username erforderlich' });
    }

    try {
      await deprovisionVm({
        store, proxmox, kasm, logger, vmid: targetVmid,
        actor: req.get('X-Actor') || (username ? username : 'admin'),
      });
      res.json({ status: 'ok', vmid: targetVmid });
    } catch (err) {
      logger.error({ vmid: targetVmid, err: err.message }, 'Deprovisioning fehlgeschlagen');
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { buildRouter };
