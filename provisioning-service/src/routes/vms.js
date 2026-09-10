// routes/vms.js
//
// Auskunft und leichte Steuerung des VM-Bestands für das Dashboard.
// Der Provisioning-Service ist die einzige Stelle mit Proxmox-/Kasm-
// Zugangsdaten; das Dashboard ruft nur hier an.
//
//   GET  /vms                        - alle zugewiesenen VMs (Admin)
//   GET  /vms/:username              - VM eines Nutzers (Selbstbedienung)
//   POST /vms/:username/keepalive    - Idle-Timer zurücksetzen
//   POST /vms/:username/reboot       - weicher Neustart des Gasts
//   GET  /history/:username          - Sitzungs-Historie eines Nutzers
//   GET  /audit                      - Audit-Log (Admin, paginiert)
//   GET  /capacity                   - Auslastung des Proxmox-Nodes (Admin)
//   GET  /status                     - Deep-Health: Proxmox/Kasm/Pool (Admin)
//   GET  /metrics                    - Prometheus-Textformat
//   GET  /pool                       - Pool-Ziel/-Ist (Admin)
//   PATCH /pool                      - Pool-Ziel zur Laufzeit ändern (Admin)
//   GET  /announcement               - aktuelles Ankündigungsbanner
//   PUT  /announcement               - Banner setzen/leeren (Admin)

const express = require('express');
const { requireApiKey } = require('../../../shared/apiKeyAuth');
const { parseGroupsHeader } = require('../access');
const {
  toPublicVm,
  auditEntry,
  parsePoolPatch,
  parseAnnouncement,
} = require('../../../shared/apiSchema');

function effectivePoolSize(store, config) {
  const override = store.read().settings.poolSizeOverride;
  return Number.isInteger(override) ? override : config.pool.size;
}

function buildRouter({ store, proxmox, kasm, config, logger, access }) {
  const router = express.Router();
  router.use(requireApiKey(config.provisioningApiKey));

  // Welche VM-Templates darf der aufrufende Nutzer anfordern? (Für die
  // Template-Auswahl im Dashboard; Gruppen kommen per X-User-Groups.)
  router.get('/templates', (req, res) => {
    const groups = parseGroupsHeader(req.get('X-User-Groups'));
    res.json({
      templates: access.templatesForGroups(groups),
      quota: access.resolveForGroups(groups).maxConcurrent,
    });
  });

  const publicOpts = () => ({
    kasmBaseUrl: config.kasm.baseUrl,
    kasmWorkspaceId: config.kasm.workspaceId,
    idleTimeoutMinutes: config.idle.timeoutMinutes,
  });

  const findAssigned = (username) =>
    Object.values(store.read().vms).find(
      (v) => v.username === username && v.status === 'assigned'
    );

  // ---- Bestand -------------------------------------------------------

  router.get('/vms', (_req, res) => {
    const assigned = Object.values(store.read().vms).filter((v) => v.status === 'assigned');
    res.json(assigned.map((v) => toPublicVm(v, publicOpts())));
  });

  router.get('/vms/:username', (req, res) => {
    const vm = findAssigned(req.params.username);
    if (!vm) return res.status(404).json({ error: 'Keine zugewiesene VM für diesen Nutzer' });
    res.json(toPublicVm(vm, publicOpts()));
  });

  // ---- Selbstbedienung: Idle-Timer verlängern ----------------------

  router.post('/vms/:username/keepalive', async (req, res) => {
    const vm = findAssigned(req.params.username);
    if (!vm) return res.status(404).json({ error: 'Keine zugewiesene VM für diesen Nutzer' });

    const until = new Date(Date.now() + config.idle.timeoutMinutes * 60_000).toISOString();
    await store.update((d) => {
      if (d.vms[vm.vmid]) {
        d.vms[vm.vmid].keepaliveUntil = until;
        d.vms[vm.vmid].lastActiveCheck = new Date().toISOString();
      }
    });
    await store.appendAudit(
      auditEntry({
        action: 'keepalive',
        actor: req.get('X-Actor') || req.params.username,
        vmid: vm.vmid,
        username: req.params.username,
      })
    );
    res.json(toPublicVm(store.read().vms[vm.vmid], publicOpts()));
  });

  // ---- Selbstbedienung: weicher Neustart --------------------------

  router.post('/vms/:username/reboot', async (req, res) => {
    const vm = findAssigned(req.params.username);
    if (!vm) return res.status(404).json({ error: 'Keine zugewiesene VM für diesen Nutzer' });
    try {
      await proxmox.rebootVm(vm.vmid);
      await store.appendAudit(
        auditEntry({
          action: 'reboot',
          actor: req.get('X-Actor') || req.params.username,
          vmid: vm.vmid,
          username: req.params.username,
        })
      );
      res.json({ status: 'ok', vmid: vm.vmid });
    } catch (err) {
      logger.error({ vmid: vm.vmid, err: err.message }, 'Neustart fehlgeschlagen');
      res.status(502).json({ error: `Neustart fehlgeschlagen: ${err.message}` });
    }
  });

  // ---- Historie & Audit ------------------------------------------

  router.get('/history/:username', (req, res) => {
    const rows = store
      .read()
      .history.filter((h) => h.username === req.params.username)
      .slice(-100)
      .reverse();
    res.json(rows);
  });

  router.get('/audit', (req, res) => {
    const all = store.read().audit;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const before = req.query.before ? Date.parse(req.query.before) : null;
    let rows = all.slice().reverse(); // neueste zuerst
    if (before) rows = rows.filter((r) => Date.parse(r.ts) < before);
    const page = rows.slice(0, limit);
    res.json({
      entries: page,
      nextBefore: page.length === limit ? page[page.length - 1].ts : null,
      total: all.length,
    });
  });

  // ---- Kapazität & Status --------------------------------------

  router.get('/capacity', async (_req, res) => {
    const vms = Object.values(store.read().vms);
    const counts = {
      assigned: vms.filter((v) => v.status === 'assigned').length,
      pool: vms.filter((v) => v.status === 'pool').length,
      claiming: vms.filter((v) => v.status === 'claiming').length,
      deprovisioning: vms.filter((v) => v.status === 'deprovisioning').length,
    };
    try {
      const node = await proxmox.getNodeStatus();
      res.json({ node, counts });
    } catch (err) {
      res.status(200).json({ node: null, counts, nodeError: err.message });
    }
  });

  router.get('/status', async (_req, res) => {
    const checks = {};
    await Promise.all([
      (async () => {
        try {
          await proxmox.getNextVmid();
          checks.proxmox = { ok: true };
        } catch (err) {
          checks.proxmox = { ok: false, error: err.message };
        }
      })(),
      (async () => {
        try {
          await kasm.getSessions();
          checks.kasm = { ok: true };
        } catch (err) {
          checks.kasm = { ok: false, error: err.message };
        }
      })(),
    ]);
    const current = Object.values(store.read().vms).filter((v) => v.status === 'pool').length;
    checks.pool = { ok: true, current, target: effectivePoolSize(store, config) };
    const ok = checks.proxmox.ok && checks.kasm.ok;
    res.status(ok ? 200 : 207).json({ ok, checks, ts: new Date().toISOString() });
  });

  router.get('/metrics', (_req, res) => {
    const data = store.read();
    const vms = Object.values(data.vms);
    const c = (s) => vms.filter((v) => v.status === s).length;
    const reaps = data.audit.filter(
      (a) => a.action === 'deprovision' && String(a.actor).startsWith('system')
    ).length;
    const lines = [
      '# HELP deskforge_vms Anzahl VMs je Status',
      '# TYPE deskforge_vms gauge',
      `deskforge_vms{status="assigned"} ${c('assigned')}`,
      `deskforge_vms{status="pool"} ${c('pool')}`,
      `deskforge_vms{status="claiming"} ${c('claiming')}`,
      `deskforge_vms{status="deprovisioning"} ${c('deprovisioning')}`,
      '# HELP deskforge_pool_target Ziel-Poolgröße',
      '# TYPE deskforge_pool_target gauge',
      `deskforge_pool_target ${effectivePoolSize(store, config)}`,
      '# HELP deskforge_audit_entries Einträge im Audit-Log',
      '# TYPE deskforge_audit_entries gauge',
      `deskforge_audit_entries ${data.audit.length}`,
      '# HELP deskforge_idle_reaps_total Automatische Abbauten (Idle-Reaper)',
      '# TYPE deskforge_idle_reaps_total counter',
      `deskforge_idle_reaps_total ${reaps}`,
      '',
    ];
    res.type('text/plain; version=0.0.4').send(lines.join('\n'));
  });

  // ---- Pool-Steuerung -----------------------------------------

  router.get('/pool', (_req, res) => {
    const current = Object.values(store.read().vms).filter((v) => v.status === 'pool').length;
    res.json({
      target: effectivePoolSize(store, config),
      configured: config.pool.size,
      override: store.read().settings.poolSizeOverride ?? null,
      current,
    });
  });

  router.patch('/pool', async (req, res) => {
    const parsed = parsePoolPatch(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    await store.update((d) => {
      d.settings.poolSizeOverride = parsed.value.size;
    });
    await store.appendAudit(
      auditEntry({
        action: 'pool.set',
        actor: req.get('X-Actor') || 'admin',
        detail: `poolSizeOverride=${parsed.value.size}`,
      })
    );
    res.json({ target: parsed.value.size, override: parsed.value.size, configured: config.pool.size });
  });

  // ---- Ankündigungsbanner -----------------------------------

  router.get('/announcement', (_req, res) => {
    res.json(store.read().announcement);
  });

  router.put('/announcement', async (req, res) => {
    const parsed = parseAnnouncement(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    await store.update((d) => {
      d.announcement = parsed.value;
    });
    await store.appendAudit(
      auditEntry({
        action: parsed.value.text ? 'announcement.set' : 'announcement.clear',
        actor: req.get('X-Actor') || 'admin',
        detail: parsed.value.text ? `${parsed.value.level}: ${parsed.value.text}` : null,
      })
    );
    res.json(parsed.value);
  });

  return router;
}

module.exports = { buildRouter, effectivePoolSize };
