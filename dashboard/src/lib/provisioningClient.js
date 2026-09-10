// lib/provisioningClient.js
//
// Einziger Kontaktpunkt des Dashboards zum Provisioning-Service. Das
// Dashboard selbst hat keine Proxmox-/Kasm-Zugangsdaten mehr - alle
// Aufrufe laufen authentifiziert (X-API-Key) über diesen Service.
//
// Die axios-Instanz (inkl. einmalig eingelesenem CA-Zertifikat) wird
// beim Laden des Moduls einmal erzeugt, nicht pro Request. Verändernde
// Aufrufe reichen zusätzlich den auslösenden Nutzer als "X-Actor" durch,
// damit der Provisioning-Service ihn im Audit-Log festhalten kann.

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const config = require('../config');

const httpsAgent =
  config.caCertPath && fs.existsSync(config.caCertPath)
    ? new https.Agent({ ca: fs.readFileSync(config.caCertPath) })
    : undefined;

const client = axios.create({
  baseURL: config.provisioning.url,
  httpsAgent,
  headers: { 'X-API-Key': config.provisioning.apiKey },
  timeout: 20000,
});

const actorHeader = (actor) => (actor ? { headers: { 'X-Actor': actor } } : undefined);
const enc = encodeURIComponent;

// ---- Selbstbedienung -------------------------------------------------

async function requestVm(username, { actor, template, groups } = {}) {
  const headers = {};
  if (actor) headers['X-Actor'] = actor;
  if (groups && groups.length) headers['X-User-Groups'] = groups.join(',');
  const opts = Object.keys(headers).length ? { headers } : undefined;
  const res = await client.post('/provision', { username, template }, opts);
  return res.data;
}

async function listTemplates(groups) {
  const opts = groups && groups.length ? { headers: { 'X-User-Groups': groups.join(',') } } : undefined;
  const res = await client.get('/templates', opts);
  return res.data;
}

async function stopVm({ vmid, username }, actor) {
  const res = await client.post('/deprovision', { vmid, username }, actorHeader(actor));
  return res.data;
}

async function getMyVm(username) {
  try {
    const res = await client.get(`/vms/${enc(username)}`);
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function keepAlive(username, actor) {
  const res = await client.post(`/vms/${enc(username)}/keepalive`, null, actorHeader(actor));
  return res.data;
}

async function rebootMyVm(username, actor) {
  const res = await client.post(`/vms/${enc(username)}/reboot`, null, actorHeader(actor));
  return res.data;
}

async function myHistory(username) {
  const res = await client.get(`/history/${enc(username)}`);
  return res.data;
}

// ---- Admin --------------------------------------------------------

async function listAllVms() {
  const res = await client.get('/vms');
  return res.data;
}

async function listSessions() {
  const res = await client.get('/sessions');
  return res.data;
}

async function listAudit({ limit, before } = {}) {
  const res = await client.get('/audit', { params: { limit, before } });
  return res.data;
}

async function capacity() {
  const res = await client.get('/capacity');
  return res.data;
}

async function deepStatus() {
  const res = await client.get('/status', { validateStatus: (s) => s === 200 || s === 207 });
  return res.data;
}

async function getPool() {
  const res = await client.get('/pool');
  return res.data;
}

async function setPool(size, actor) {
  const res = await client.patch('/pool', { size }, actorHeader(actor));
  return res.data;
}

// ---- Ankündigungsbanner (lesen: jeder; setzen: Admin) -------------

async function getAnnouncement() {
  const res = await client.get('/announcement');
  return res.data;
}

async function setAnnouncement({ text, level }, actor) {
  const res = await client.put('/announcement', { text, level }, actorHeader(actor));
  return res.data;
}

// ---- API-Tokens (nur Admin) --------------------------------------

async function listTokens() {
  const res = await client.get('/tokens');
  return res.data;
}

async function createToken({ name, username }, actor) {
  const res = await client.post('/tokens', { name, username }, actorHeader(actor));
  return res.data;
}

async function deleteToken(id, actor) {
  const res = await client.delete(`/tokens/${enc(id)}`, actorHeader(actor));
  return res.data;
}

module.exports = {
  requestVm,
  listTemplates,
  stopVm,
  getMyVm,
  keepAlive,
  rebootMyVm,
  myHistory,
  listAllVms,
  listSessions,
  listAudit,
  capacity,
  deepStatus,
  getPool,
  setPool,
  getAnnouncement,
  setAnnouncement,
  listTokens,
  createToken,
  deleteToken,
};
