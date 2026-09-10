// routes/provision.js
//
// POST /provision    - liefert eine VM für den angegebenen Nutzer (aus
//                       dem Pool, falls verfügbar und Default-Template,
//                       sonst frisch geklont). Prüft Template-Freigabe
//                       und Kontingent anhand der Nutzergruppen
//                       (X-User-Groups, vom Dashboard gesetzt) bzw. der
//                       access.json (siehe src/access.js).
// POST /deprovision  - baut eine VM wieder ab (per vmid ODER username).
//
// Authentifizierung: gemeinsamer X-API-Key (voller Zugriff) ODER ein an
// einen Nutzer gebundenes Bearer-Token (siehe src/tokens.js).

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireApiKeyOrToken } = require('../tokens');
const { parseGroupsHeader } = require('../access');
const { createPoolVm, allocateAndCloneVm, assignVmToUser, deprovisionVm } = require('../vmLifecycle');
const { ensurePoolSize } = require('../jobs/poolMaintainer');

function findExistingAssignment(store, username) {
  return Object.values(store.read().vms).find((v) => v.username === username && v.status === 'assigned');
}

function findFreePoolVm(store) {
  return Object.values(store.read().vms).find((v) => v.status === 'pool');
}

function countActiveForUser(store, username) {
  return Object.values(store.read().vms).filter(
    (v) => v.username === username && (v.status === 'assigned' || v.status === 'claiming')
  ).length;
}

function buildRouter({ store, proxmox, kasm, mutex, config, logger, access }) {
  const router = express.Router();

  const provisionLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 3,
    keyGenerator: (req) => req.body?.username || req.ip,
    message: { error: 'Zu viele Provisioning-Anfragen für diesen Nutzer - bitte kurz warten.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
  });

  router.use(requireApiKeyOrToken(config.provisioningApiKey, store));

  router.post('/provision', provisionLimiter, async (req, res) => {
    let { username, template } = req.body || {};

    // An einen Nutzer gebundenes Token: username erzwingen.
    if (req.auth.kind === 'token' && req.auth.username !== '*') {
      username = req.auth.username;
    }
    if (!username) {
      return res.status(400).json({ error: 'username fehlt im Request-Body' });
    }

    // Token-Aufrufe haben keine Gruppen -> "*"-Regel; kein Gruppen-Kontingent.
    const groups = req.auth.kind === 'admin' ? parseGroupsHeader(req.get('X-User-Groups')) : [];
    template = template || access.defaultTemplate();

    if (!access.templateExists(template)) {
      return res.status(400).json({ error: `Unbekanntes VM-Template "${template}"` });
    }
    if (!access.canUseTemplate(groups, template)) {
      return res.status(403).json({ error: `VM-Template "${template}" ist für deine Gruppe nicht freigegeben` });
    }

    const existing = findExistingAssignment(store, username);
    if (existing) {
      logger.info({ username, vmid: existing.vmid }, 'Nutzer hat bereits eine zugewiesene VM, gebe diese zurück');
      return res.json({ status: 'ok', reused: true, vmid: existing.vmid, ip: existing.ip, kasmServerId: existing.kasmServerId, template: existing.template || 'standard' });
    }

    // Kontingent nur für gruppenbasierte (Dashboard-)Anfragen.
    if (req.auth.kind === 'admin') {
      const rule = access.resolveForGroups(groups);
      if (countActiveForUser(store, username) >= rule.maxConcurrent) {
        return res.status(429).json({
          error: `Kontingent erreicht (max. ${rule.maxConcurrent} gleichzeitige VM${rule.maxConcurrent === 1 ? '' : 's'})`,
        });
      }
    }

    const isDefaultTemplate = template === access.defaultTemplate();

    let vmid;
    try {
      const release = await mutex.acquire();
      let poolVm;
      try {
        // Nur Default-Template-Anfragen dürfen aus dem Pool bedient werden.
        poolVm = isDefaultTemplate ? findFreePoolVm(store) : null;
        if (poolVm) {
          await store.update((d) => { d.vms[poolVm.vmid].status = 'claiming'; });
        }
      } finally {
        release();
      }

      if (poolVm) {
        vmid = poolVm.vmid;
        logger.info({ vmid, username, template }, 'Weise Pool-VM zu');
      } else {
        logger.info({ username, template }, 'Kein Pool-VM frei/passend, klone eine frische VM (dauert länger)');
        vmid = await allocateAndCloneVm({
          proxmox, mutex, config,
          name: `deskforge-${username}-${Date.now()}`.toLowerCase(),
          templateVmid: access.templateVmid(template),
        });
        await proxmox.startVm(vmid);
        await proxmox.waitForGuestAgent(vmid);
        const ip = await proxmox.getGuestIpAddress(vmid);
        await store.update((d) => {
          d.vms[vmid] = {
            vmid, name: `deskforge-${username}-${vmid}`, status: 'claiming', username: null,
            template, kasmServerId: null, ip, createdAt: new Date().toISOString(),
            assignedAt: null, lastActiveCheck: null,
          };
        });
      }

      await store.update((d) => { if (d.vms[vmid]) d.vms[vmid].template = template; });

      const result = await assignVmToUser({
        store, proxmox, kasm, config, logger, vmid, username,
        actor: req.auth.kind === 'token' ? `token:${req.auth.tokenId}` : (req.get('X-Actor') || username),
      });

      res.json({ status: 'ok', reused: false, template, ...result });

      ensurePoolSize({ store, proxmox, mutex, config, logger }).catch((err) =>
        logger.error({ err: err.message }, 'Pool-Auffüllung nach Zuweisung fehlgeschlagen')
      );
    } catch (err) {
      logger.error({ username, err: err.message }, 'Provisioning fehlgeschlagen');
      if (vmid) {
        deprovisionVm({ store, proxmox, kasm, logger, vmid, actor: 'system:cleanup' }).catch((cleanupErr) =>
          logger.error({ vmid, err: cleanupErr.message }, 'Aufräumen nach Fehler fehlgeschlagen')
        );
      }
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  router.post('/deprovision', async (req, res) => {
    const { vmid } = req.body || {};
    let { username } = req.body || {};
    let targetVmid = vmid;

    if (req.auth.kind === 'token' && req.auth.username !== '*') {
      if (username && username !== req.auth.username) {
        return res.status(403).json({ error: 'Token darf nur die eigene VM abbauen' });
      }
      username = req.auth.username;
    }

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
        actor: req.auth.kind === 'token' ? `token:${req.auth.tokenId}` : (req.get('X-Actor') || username || 'admin'),
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
