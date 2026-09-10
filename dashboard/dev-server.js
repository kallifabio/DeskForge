// dev-server.js
//
// NUR fuer die lokale Vorschau der Oberflaeche gedacht - NICHT fuer den
// Produktivbetrieb. Liefert das Frontend aus src/public aus und
// beantwortet alle /api/*-Aufrufe mit erfundenen Beispieldaten, damit
// man das Dashboard ohne Authentik-SSO, LDAP und Provisioning-Service
// im Browser ansehen kann.
//
// Start:  node dev-server.js            (Admin-Ansicht, Standard)
//         ROLE=user node dev-server.js  (nur Selbstbedienungs-Ansicht)
//
// Danach http://localhost:5000 oeffnen.

const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 5000;
const IS_ADMIN = (process.env.ROLE || 'admin').toLowerCase() === 'admin';

const app = express();
app.use(express.json());

// Eine "eigene VM" simulieren, damit man beide Zustaende sieht:
// null  -> "VM anfordern"-Button
// Objekt -> laufende Sitzung + "Sitzung beenden"-Button
let myVm = {
  vmid: 101,
  ip: '10.20.0.101',
  assignedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
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
  { vmid: 101, username: 'alice', ip: '10.20.0.101', assignedAt: new Date(Date.now() - 3 * 3600e3).toISOString() },
  { vmid: 102, username: 'bob', ip: '10.20.0.102', assignedAt: new Date(Date.now() - 26 * 3600e3).toISOString() },
];

app.get('/api/me', (_req, res) => {
  res.json({ username: IS_ADMIN ? 'admin' : 'alice', email: 'you@deskforge.local', isAdmin: IS_ADMIN });
});

app.get('/api/my-vm', (_req, res) => res.json(myVm));
app.post('/api/my-vm', (_req, res) => {
  myVm = { vmid: 199, ip: '10.20.0.199', assignedAt: new Date().toISOString() };
  res.json(myVm);
});
app.delete('/api/my-vm', (_req, res) => {
  myVm = null;
  res.json({ ok: true });
});

app.get('/api/users', (_req, res) => res.json(users));
app.get('/api/sessions', (_req, res) => res.json(sessions));
app.get('/api/vms', (_req, res) => res.json(vms));

app.post('/api/vms/provision', (req, res) => {
  const username = (req.body && req.body.username) || 'neu';
  const vm = { vmid: 200 + vms.length, username, ip: `10.20.0.${200 + vms.length}`, assignedAt: new Date().toISOString() };
  vms.push(vm);
  res.json(vm);
});
app.delete('/api/vms/:vmid', (req, res) => {
  vms = vms.filter((v) => String(v.vmid) !== String(req.params.vmid));
  res.json({ ok: true });
});

// Logout im Dev-Modus: einfach zurueck zur Startseite.
app.get('/auth/logout', (_req, res) => res.redirect('/'));

app.use(express.static(path.join(__dirname, 'src', 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'src', 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`DeskForge-Dashboard (DEV-Vorschau, ${IS_ADMIN ? 'Admin' : 'Nutzer'}) -> http://localhost:${PORT}`);
});
