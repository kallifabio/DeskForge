// config.js
// Liest und validiert alle Einstellungen aus Umgebungsvariablen (.env)
// mit "zod" - sammelt alle Probleme statt bei der ersten fehlenden
// Variable abzubrechen.
//
// Das Dashboard braucht seit der Umstellung auf den zentralen
// Provisioning-Service KEINE eigenen Proxmox-/Kasm-Zugangsdaten mehr -
// das reduziert die Angriffsfläche, falls das Dashboard selbst
// kompromittiert wird.

require('dotenv').config();
const { z } = require('zod');

// Verhindert, dass die Platzhalterwerte aus .env.example ("bitte ändern")
// unbemerkt in den Betrieb gelangen.
const noPlaceholder = (v) => !/bitte[-\s]?änder/i.test(v);
const PLACEHOLDER_MSG = 'enthält noch einen Platzhalter ("bitte ändern") - echten Wert setzen';

const secret = (label) =>
  z.string().min(1, `${label} fehlt`).refine(noPlaceholder, { message: PLACEHOLDER_MSG });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  LOG_LEVEL: z.string().default('info'),
  SESSION_SECRET: z
    .string()
    .min(16, 'muss mindestens 16 Zeichen lang sein')
    .refine(noPlaceholder, { message: PLACEHOLDER_MSG }),
  CA_CERT_PATH: z.string().optional(),

  // Öffentliche Basis-URL des Dashboards (für CSRF-Ursprungsprüfung und
  // den Post-Logout-Redirect). Optional - ohne wird der Ursprung aus dem
  // Request abgeleitet.
  PUBLIC_URL: z.string().url().optional(),

  // Optionaler Redis-Session-Store.
  REDIS_URL: z.string().url().optional(),

  AUTHENTIK_ISSUER_URL: z.string().url(),
  AUTHENTIK_CLIENT_ID: secret('AUTHENTIK_CLIENT_ID'),
  AUTHENTIK_CLIENT_SECRET: secret('AUTHENTIK_CLIENT_SECRET'),
  AUTHENTIK_REDIRECT_URI: z.string().url(),
  AUTHENTIK_POST_LOGOUT_REDIRECT_URI: z.string().url().optional(),
  // Name der Authentik-Gruppe, deren Mitglieder im Dashboard
  // Administratorrechte bekommen (alle Nutzer, alle Sitzungen, alle VMs).
  AUTHENTIK_ADMIN_GROUP: z.string().default('deskforge-admins'),

  LDAP_URL: z.string().min(1),
  LDAP_BIND_DN: z.string().min(1),
  LDAP_BIND_PASSWORD: secret('LDAP_BIND_PASSWORD'),
  LDAP_BASE_DN: z.string().min(1),

  PROVISIONING_SERVICE_URL: z.string().url(),
  PROVISIONING_API_KEY: z
    .string()
    .min(16, 'muss mindestens 16 Zeichen lang sein')
    .refine(noPlaceholder, { message: PLACEHOLDER_MSG }),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    `Ungültige oder fehlende Konfiguration in dashboard/.env:\n${lines.join('\n')}\n` +
    `(siehe .env.example für alle benötigten Variablen)`
  );
}

const env = parsed.data;

module.exports = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  sessionSecret: env.SESSION_SECRET,
  caCertPath: env.CA_CERT_PATH || null,
  publicUrl: env.PUBLIC_URL || null,
  redisUrl: env.REDIS_URL || null,

  authentik: {
    issuerUrl: env.AUTHENTIK_ISSUER_URL,
    clientId: env.AUTHENTIK_CLIENT_ID,
    clientSecret: env.AUTHENTIK_CLIENT_SECRET,
    redirectUri: env.AUTHENTIK_REDIRECT_URI,
    postLogoutRedirectUri:
      env.AUTHENTIK_POST_LOGOUT_REDIRECT_URI || env.PUBLIC_URL || null,
    adminGroup: env.AUTHENTIK_ADMIN_GROUP,
  },

  ldap: {
    url: env.LDAP_URL,
    bindDn: env.LDAP_BIND_DN,
    bindPassword: env.LDAP_BIND_PASSWORD,
    baseDn: env.LDAP_BASE_DN,
  },

  provisioning: {
    url: env.PROVISIONING_SERVICE_URL,
    apiKey: env.PROVISIONING_API_KEY,
  },
};
