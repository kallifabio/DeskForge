// shared/kasmClient.js
//
// Wrapper um die Kasm-Workspaces-API. Nimmt wie ProxmoxClient eine bereits
// fertig konfigurierte Axios-Instanz entgegen (siehe dortigen Kommentar
// zur Begründung).
//
// WICHTIG: Kasm ändert Feldnamen in JSON-Antworten gelegentlich zwischen
// Versionen. Falls REGISTRATION_TOKEN_FIELD_CANDIDATES unten nicht greift,
// im Browser die Netzwerk-Ansicht der Kasm-Admin-Oberfläche öffnen
// (Infrastructure -> Servers -> Edit) und nachsehen, wie das Feld in
// deiner Version heißt.

const REGISTRATION_TOKEN_FIELD_CANDIDATES = [
  'agent_registration_token',
  'registration_token',
  'token',
];

class KasmClient {
  constructor(axiosInstance, { apiKey, apiKeySecret, maxSimultaneousSessions = 1, maxSimultaneousUsers = 1 }) {
    this.client = axiosInstance;
    this.apiKey = apiKey;
    this.apiKeySecret = apiKeySecret;
    this.maxSimultaneousSessions = maxSimultaneousSessions;
    this.maxSimultaneousUsers = maxSimultaneousUsers;
  }

  _auth() {
    return { api_key: this.apiKey, api_key_secret: this.apiKeySecret };
  }

  async getZones() {
    const res = await this.client.post('/api/public/get_zones', this._auth());
    return res.data.zones || res.data;
  }

  async createServer({ name, ip, zoneId, port = 443 }) {
    const body = {
      ...this._auth(),
      target_server: {
        server_name: name,
        hostname: ip,
        port,
        zone_id: zoneId,
        max_simultaneous_sessions: this.maxSimultaneousSessions,
        max_simultaneous_users: this.maxSimultaneousUsers,
      },
    };
    const res = await this.client.post('/api/public/create_server', body);
    return res.data.server_id || (res.data.target_server && res.data.target_server.server_id);
  }

  async getServers() {
    const res = await this.client.post('/api/admin/get_servers', this._auth());
    return res.data.servers || res.data;
  }

  // Holt die Serverliste über die Admin-API und extrahiert daraus das
  // Registrierungs-Token für die gegebene server_id.
  async getServerRegistrationToken(serverId) {
    const servers = await this.getServers();
    const server = servers.find((s) => s.server_id === serverId);
    if (!server) {
      throw new Error(`Server ${serverId} nicht in get_servers-Antwort gefunden`);
    }
    for (const field of REGISTRATION_TOKEN_FIELD_CANDIDATES) {
      if (server[field]) {
        return server[field];
      }
    }
    throw new Error(
      `Kein bekanntes Token-Feld im Server-Objekt gefunden. ` +
      `Verfügbare Felder: ${Object.keys(server).join(', ')}. ` +
      `Bitte REGISTRATION_TOKEN_FIELD_CANDIDATES in kasmClient.js ergänzen.`
    );
  }

  async deleteServer(serverId) {
    await this.client.post('/api/admin/delete_server', {
      ...this._auth(),
      target_server: { server_id: serverId },
    });
  }

  // Aktive Sitzungen - wird sowohl vom Idle-Reaper (prüft, ob eine VM noch
  // gebraucht wird) als auch vom Dashboard (Admin-Übersicht) genutzt.
  async getSessions() {
    const res = await this.client.post('/api/admin/get_kasms', this._auth());
    return res.data.kasms || res.data;
  }
}

module.exports = { KasmClient, REGISTRATION_TOKEN_FIELD_CANDIDATES };
