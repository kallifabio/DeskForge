// lib/provisioningClient.js
//
// Einziger Kontaktpunkt des Dashboards zum Provisioning-Service. Das
// Dashboard selbst hat keine Proxmox-/Kasm-Zugangsdaten mehr - alle
// Aufrufe laufen authentifiziert (X-API-Key) über diesen Service.
//
// Die axios-Instanz (inkl. einmalig eingelesenem CA-Zertifikat) wird
// beim Laden des Moduls einmal erzeugt, nicht pro Request.

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

async function requestVm(username) {
  const res = await client.post('/provision', { username });
  return res.data;
}

async function stopVm({ vmid, username }) {
  const res = await client.post('/deprovision', { vmid, username });
  return res.data;
}

async function getMyVm(username) {
  try {
    const res = await client.get(`/vms/${encodeURIComponent(username)}`);
    return res.data;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function listAllVms() {
  const res = await client.get('/vms');
  return res.data;
}

async function listSessions() {
  const res = await client.get('/sessions');
  return res.data;
}

module.exports = { requestVm, stopVm, getMyVm, listAllVms, listSessions };
