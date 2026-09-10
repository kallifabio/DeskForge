// clients.js
// Baut die fertig konfigurierten Proxmox-/Kasm-Clients aus shared/.
// Dies ist die einzige Stelle im ganzen Toolkit, die noch eigene
// Axios-Instanzen mit Auth-Headern/CA-Zertifikat zusammenbaut - die
// eigentliche API-Logik liegt einmalig in shared/.

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const { ProxmoxClient } = require('../../shared/proxmoxClient');
const { KasmClient } = require('../../shared/kasmClient');

function buildHttpsAgent(config) {
  if (!config.caCertPath || !fs.existsSync(config.caCertPath)) {
    return undefined;
  }
  return new https.Agent({ ca: fs.readFileSync(config.caCertPath) });
}

function buildProxmoxClient(config) {
  const axiosInstance = axios.create({
    baseURL: config.proxmox.baseUrl,
    httpsAgent: buildHttpsAgent(config),
    headers: { Authorization: `PVEAPIToken=${config.proxmox.tokenId}=${config.proxmox.tokenSecret}` },
    timeout: 15000,
  });
  return new ProxmoxClient(axiosInstance, { node: config.proxmox.node });
}

function buildKasmClient(config) {
  const axiosInstance = axios.create({
    baseURL: config.kasm.baseUrl,
    httpsAgent: buildHttpsAgent(config),
    timeout: 15000,
  });
  return new KasmClient(axiosInstance, {
    apiKey: config.kasm.apiKey,
    apiKeySecret: config.kasm.apiKeySecret,
    maxSimultaneousSessions: config.kasm.maxSimultaneousSessions,
    maxSimultaneousUsers: config.kasm.maxSimultaneousUsers,
  });
}

module.exports = { buildProxmoxClient, buildKasmClient };
