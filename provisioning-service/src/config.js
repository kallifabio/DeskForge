// config.js
// Liest und validiert alle Einstellungen aus Umgebungsvariablen (.env)
// mit "zod". Statt bei der ersten fehlenden Variable sofort abzubrechen,
// werden ALLE Probleme gesammelt und in einer verständlichen deutschen
// Fehlermeldung ausgegeben.

require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default('info'),

  // Gemeinsamer Schlüssel zwischen Dashboard und Provisioning-Service.
  PROVISIONING_API_KEY: z.string().min(16, 'muss mindestens 16 Zeichen lang sein (z.B. mit openssl rand -hex 32 erzeugen)'),

  CA_CERT_PATH: z.string().optional(),

  PROXMOX_BASE_URL: z.string().url('muss eine gültige URL sein, z.B. https://proxmox.deskforge.local:8006/api2/json'),
  PROXMOX_TOKEN_ID: z.string().min(1),
  PROXMOX_TOKEN_SECRET: z.string().min(1),
  PROXMOX_NODE: z.string().min(1),
  PROXMOX_TEMPLATE_VMID: z.coerce.number().int().positive(),
  PROXMOX_CLONE_MODE: z.enum(['full', 'linked']).default('full'),

  KASM_BASE_URL: z.string().url(),
  KASM_API_KEY: z.string().min(1),
  KASM_API_KEY_SECRET: z.string().min(1),
  KASM_ZONE_ID: z.string().min(1),
  // Optional: ID des Kasm-Workspace/-Images, auf den der "Verbinden"-
  // Button im Dashboard direkt verlinken soll (.../#/launch/<id>).
  // Ohne Wert verweist der Link auf den Kasm-Staging-Screen.
  KASM_WORKSPACE_ID: z.string().optional(),
  KASM_MAX_SIMULTANEOUS_SESSIONS: z.coerce.number().default(1),
  KASM_MAX_SIMULTANEOUS_USERS: z.coerce.number().default(1),

  WINDOWS_AGENT_SCRIPT_PATH: z.string().default('C:\\ProvisionAgent\\register-vm.ps1'),

  // Pool vorgewärmter VMs, siehe src/jobs/poolMaintainer.js
  POOL_SIZE: z.coerce.number().int().min(0).default(1),
  POOL_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  // Idle-Timeout, siehe src/jobs/idleReaper.js
  IDLE_TIMEOUT_MINUTES: z.coerce.number().positive().default(60),
  IDLE_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60_000),

  STATE_FILE_PATH: z.string().default('./data/state.json'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    `Ungültige oder fehlende Konfiguration in provisioning-service/.env:\n${lines.join('\n')}\n` +
    `(siehe .env.example für alle benötigten Variablen)`
  );
}

const env = parsed.data;

module.exports = {
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  provisioningApiKey: env.PROVISIONING_API_KEY,
  caCertPath: env.CA_CERT_PATH || null,

  proxmox: {
    baseUrl: env.PROXMOX_BASE_URL,
    tokenId: env.PROXMOX_TOKEN_ID,
    tokenSecret: env.PROXMOX_TOKEN_SECRET,
    node: env.PROXMOX_NODE,
    templateVmid: env.PROXMOX_TEMPLATE_VMID,
    cloneMode: env.PROXMOX_CLONE_MODE,
  },

  kasm: {
    baseUrl: env.KASM_BASE_URL,
    apiKey: env.KASM_API_KEY,
    apiKeySecret: env.KASM_API_KEY_SECRET,
    zoneId: env.KASM_ZONE_ID,
    workspaceId: env.KASM_WORKSPACE_ID || null,
    maxSimultaneousSessions: env.KASM_MAX_SIMULTANEOUS_SESSIONS,
    maxSimultaneousUsers: env.KASM_MAX_SIMULTANEOUS_USERS,
  },

  windowsAgentScriptPath: env.WINDOWS_AGENT_SCRIPT_PATH,

  pool: {
    size: env.POOL_SIZE,
    checkIntervalMs: env.POOL_CHECK_INTERVAL_MS,
  },

  idle: {
    timeoutMinutes: env.IDLE_TIMEOUT_MINUTES,
    checkIntervalMs: env.IDLE_CHECK_INTERVAL_MS,
  },

  stateFilePath: env.STATE_FILE_PATH,
};
