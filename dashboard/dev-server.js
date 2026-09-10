// dev-server.js
//
// NUR fuer die lokale Vorschau der Oberflaeche gedacht - NICHT fuer den
// Produktivbetrieb. Liefert das Frontend aus src/public aus und
// beantwortet alle /api/*-Aufrufe (inkl. SSE /api/events) mit erfundenen
// Beispieldaten, damit man das Dashboard ohne Authentik-SSO, LDAP und
// Provisioning-Service im Browser ansehen kann.
//
// Start:  node dev-server.js            (Admin-Ansicht, Standard)
//         ROLE=user node dev-server.js  (nur Selbstbedienungs-Ansicht)
//
// Danach http://localhost:5000 oeffnen.

const path = require('path');
const express = require('express');
const { toPublicVm } = require('../shared/apiSchema');

const PORT = process.env.PORT || 5000;
const IS_ADMIN = (process.env.ROLE || 'admin').toLowerCase() === 'admin';
const KASM_BASE = 'https://kasm.deskforge.local';
const IDLE_MIN = 60;
const pub = (vm) => toPublicVm(vm, { kasmBaseUrl: KASM_BASE, idleTimeoutMinutes: IDLE_MIN });

const app = express();
app.use(express.json());

let myVm = {
  vmid: 101,
  name: 'deskforge-you-101',
  status: 'assigned',
  username: IS_ADMIN ? 'admin' : 'alice',
  ip: '10.20.0.101',
  kasmServerId: 'srv-101',
  createdAt: new Date(Date.now() - 4 * 3600e3).toISOString(),
  assignedAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
  idleSince: new Date(Date.now() - 40 * 60e3).toISOString(),
  keepaliveUntil: null,
  lastActiveCheck: new Date(Date.now() - 40 * 60e3).toISOString(),
};

const users = [
  { uid: 'alice', name: 'Alice Achterberg', email: 'alice@deskforge.local' },
  { uid: 'bob', name: 'Bob Brenner', email: 'bob@deskforge.local' },
  { uid: 'carol', name: 'Carol Cramer', email: 'carol@deskforge.local' },
];
const sessions = [
  { kasm_id: 'kasm-8f2a', user_id: 'alice', operational_status: 'running' },
  { kasm_id: 'kasm-1c7d', user_id: 'bob', operational_status: 'starting' },
];
let vms = [
  { vmid: 101, status: 'assigned', username: 'alice', ip: '10.20.0.101', kasmServerId: 'srv-101',
    assignedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), idleSince: new Date(Date.now() - 40 * 60e3).toISOString() },
  { vmid: 102, status: 'assigned', username: 'bob', ip: '10.20.0.102', kasmServerId: 'srv-102',
    assignedAt: new Date(Date.now() - 26 * 3600e3).toISOString(), idleSince: new Date(Date.now() - 5 * 60e3).toISOString() },
];
let announcement = { text: '', level: 'info', updatedAt: null };
const audit = [
  { ts: new Date(Date.now() - 3 * 3600e3).toISOString(), action: 'assign', actor: 'alice', vmid: 101, username: 'alice', detail: null },
  { ts: new Date(Date.now() - 26 * 3600e3).toISOString(), action: 'assign', actor: 'admin', vmid: 102, username: 'bob', detail: null },
  { ts: new Date(Date.now() - 20 * 3600e3).toISOString(), action: 'deprovision', actor: 'system:idle', vmid: 99, username: 'carol', detail: null },
];
let poolOverride = null;
const history = [
  { vmid: 88, username: IS_ADMIN ? 'admin' : 'alice', assignedAt: new Date(Date.now() - 48 * 3600e3).toISOString(),
    endedAt: new Date(Date.now() - 46 * 3600e3).toISOString(), durationMinutes: 120, endedBy: 'system:idle' },
];

app.get('/api/me', (_req, res) =>
  res.json({ username: IS_ADMIN ? 'admin' : 'alice', email: 'you@deskforge.local', isAdmin: IS_ADMIN }));

app.get('/api/my-vm', (_req, res) => res.json(myVm ? pub(myVm) : null));
app.post('/api/my-vm', (_req, res) => {
  myVm = { ...myVm, vmid: 199, ip: '10.20.0.199', status: 'assigned', kasmServerId: 'srv-199',
    assignedAt: new Date().toISOString(), idleSince: new Date().toISOString(), keepaliveUntil: null };
  res.json(pub(myVm));
});
app.delete('/api/my-vm', (_req, res) => { myVm = null; res.json({ ok: true }); });
app.post('/api/my-vm/keepalive', (_req, res) => {
  myVm.keepaliveUntil = new Date(Date.now() + IDLE_MIN * 60e3).toISOString();
  myVm.lastActiveCheck = new Date().toISOString();
  res.json(pub(myVm));
});
app.post('/api/my-vm/reboot', (_req, res) => res.json({ status: 'ok', vmid: myVm && myVm.vmid }));
app.get('/api/my-history', (_req, res) => res.json(history));

app.get('/api/announcement', (_req, res) => res.json(announcement));
app.put('/api/announcement', (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  const level = ['info', 'warning', 'critical'].includes(req.body && req.body.level) ? req.body.level : 'info';
  announcement = { text, level, updatedAt: new Date().toISOString() };
  res.json(announcement);
});

app.get('/api/templates', (_req, res) => res.json({
  templates: [
    { name: 'standard', label: 'Standard (Buero)', default: true },
    { name: 'dev', label: 'Entwicklung (mehr RAM)', default: false },
  ],
  quota: IS_ADMIN ? 10 : 2,
}));

let tokens = [
  { id: 't-1', name: 'ci-runner', username: '*', tokenPrefix: 'dfp_9a3f2b', createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), createdBy: 'admin', lastUsedAt: new Date(Date.now() - 3600e3).toISOString() },
];
app.get('/api/tokens', (_req, res) => res.json(tokens));
app.post('/api/tokens', (req, res) => {
  const raw = 'dfp_' + Math.random().toString(16).slice(2).padEnd(48, '0').slice(0, 48);
  const entry = { id: 't-' + (tokens.length + 1), name: (req.body && req.body.name) || 'unbenannt',
    username: (req.body && req.body.username) || '*', tokenPrefix: raw.slice(0, 10),
    createdAt: new Date().toISOString(), createdBy: 'admin', lastUsedAt: null };
  tokens.push(entry);
  res.status(201).json({ token: raw, ...entry });
});
app.delete('/api/tokens/:id', (req, res) => {
  tokens = tokens.filter((t) => t.id !== req.params.id);
  res.json({ status: 'ok' });
});

app.get('/api/users', (_req, res) => res.json(users));
app.get('/api/sessions', (_req, res) => res.json(sessions));
app.get('/api/vms', (_req, res) => res.json(vms.map(pub)));

app.post('/api/vms/provision', (req, res) => {
  const username = (req.body && req.body.username) || 'neu';
  const vm = { vmid: 200 + vms.length, status: 'assigned', username, ip: `10.20.0.${200 + vms.length}`,
    kasmServerId: `srv-${200 + vms.length}`, assignedAt: new Date().toISOString(), idleSince: new Date().toISOString() };
  vms.push(vm);
  audit.unshift({ ts: new Date().toISOString(), action: 'assign', actor: 'admin', vmid: vm.vmid, username, detail: null });
  res.json(pub(vm));
});
app.delete('/api/vms/:vmid', (req, res) => {
  vms = vms.filter((v) => String(v.vmid) !== String(req.params.vmid));
  audit.unshift({ ts: new Date().toISOString(), action: 'deprovision', actor: 'admin', vmid: Number(req.params.vmid), username: null, detail: null });
  res.json({ ok: true });
});

app.get('/api/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const before = req.query.before ? Date.parse(req.query.before) : null;
  let rows = audit.slice();
  if (before) rows = rows.filter((r) => Date.parse(r.ts) < before);
  const page = rows.slice(0, limit);
  res.json({ entries: page, nextBefore: page.length === limit ? page[page.length - 1].ts : null, total: audit.length });
});

app.get('/api/capacity', (_req, res) => res.json({
  node: { node: 'pve', cpu: 0.34, cpuCount: 12, memTotal: 68719476736, memUsed: 41231686042,
    storageTotal: 1099511627776, storageUsed: 486539306598, uptimeSeconds: 812345, loadavg: ['2.1', '1.8', '1.6'] },
  counts: { assigned: vms.length, pool: poolOverride ?? 1, claiming: 0, deprovisioning: 0 },
}));

app.get('/api/status', (_req, res) => res.json({
  ok: true,
  checks: { proxmox: { ok: true }, kasm: { ok: true }, pool: { ok: true, current: 1, target: poolOverride ?? 1 } },
  ts: new Date().toISOString(),
}));

app.get('/api/pool', (_req, res) => res.json({
  target: poolOverride ?? 1, configured: 1, override: poolOverride, current: 1,
}));
app.patch('/api/pool', (req, res) => {
  poolOverride = Number(req.body && req.body.size);
  res.json({ target: poolOverride, override: poolOverride, configured: 1 });
});

// SSE-Live-Stream
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const push = () => {
    const payload = {
      ts: new Date().toISOString(),
      myVm: myVm ? pub(myVm) : null,
      announcement,
      admin: IS_ADMIN
        ? {
            vms: vms.map(pub),
            status: { ok: true, checks: { proxmox: { ok: true }, kasm: { ok: true }, pool: { ok: true, current: 1, target: poolOverride ?? 1 } } },
            capacity: { node: { node: 'pve', cpu: 0.3 + Math.random() * 0.2, memTotal: 68719476736, memUsed: 41231686042, storageTotal: 1099511627776, storageUsed: 486539306598 }, counts: { assigned: vms.length, pool: poolOverride ?? 1, claiming: 0, deprovisioning: 0 } },
          }
        : null,
    };
    res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  push();
  const iv = setInterval(push, 5000);
  req.on('close', () => clearInterval(iv));
});

app.get('/auth/logout', (_req, res) => res.redirect('/'));

app.use(express.static(path.join(__dirname, 'src', 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`DeskForge-Dashboard (DEV-Vorschau, ${IS_ADMIN ? 'Admin' : 'Nutzer'}) -> http://localhost:${PORT}`);
});
