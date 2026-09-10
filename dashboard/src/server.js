// server.js
// Verwaltungs-Dashboard: Anmeldung per Authentik-SSO, danach je nach
// Rolle entweder die Selbstbedienungs-Ansicht (eigene VDI-Sitzung
// anfordern/beenden) oder die Administrator-Übersicht (Nutzer, alle
// Sitzungen, alle VMs).

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const logger = require('./logger');
const { buildSessionMiddleware } = require('./sessionStore');
const { buildHelmet, csrfOriginGuard } = require('./security');
const { notFound, buildErrorHandler } = require('./errorHandler');
const { buildAuthRouter, requireAuth, requireAdmin } = require('./auth');
const ldap = require('./lib/ldap');
const provisioning = require('./lib/provisioningClient');

const app = express();

// Hinter dem Reverse-Proxy: X-Forwarded-* auswerten (korrektes
// req.protocol/req.ip für Secure-Cookies, CSRF-Prüfung, Rate-Limit).
app.set('trust proxy', 1);

app.use(buildHelmet());
app.use(express.json());
app.use(buildSessionMiddleware(config, logger));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/auth', buildAuthRouter());
// index:false -> "/" wird NICHT automatisch als index.html ausgeliefert,
// sondern läuft unten durch requireAuth.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// CSRF-Schutz für alle verändernden /api-Aufrufe (Origin muss der
// eigene Ursprung sein).
app.use('/api', csrfOriginGuard(config));

// Teure Operation gegen Missbrauch drosseln.
const provisionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Schlüssel per Session-sub, nicht per IP
  keyGenerator: (req) =>
    req.session && req.session.user ? `u:${req.session.user.sub}` : `ip:${req.ip}`,
  message: {
    error: 'Zu viele Provisionierungs-Anfragen - bitte in einigen Minuten erneut versuchen.',
  },
});

app.get('/', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/me', requireAuth, (req, res) => {
  const { username, email, isAdmin } = req.session.user;
  res.json({ username, email, isAdmin });
});

// ---- Selbstbedienung (jeder angemeldete Nutzer, auch Admins) ----------

app.get('/api/my-vm', requireAuth, async (req, res) => {
  try {
    const vm = await provisioning.getMyVm(req.session.user.username);
    res.json(vm);
  } catch (err) {
    logger.error({ err: err.message }, 'Abfrage der eigenen VM fehlgeschlagen');
    res.status(502).json({ error: `Provisioning-Service nicht erreichbar: ${err.message}` });
  }
});

app.post('/api/my-vm', requireAuth, provisionLimiter, async (req, res) => {
  try {
    const result = await provisioning.requestVm(req.session.user.username);
    res.json(result);
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    logger.error({ detail }, 'Provisioning fehlgeschlagen');
    res.status(err.response?.status || 502).json(detail);
  }
});

app.delete('/api/my-vm', requireAuth, async (req, res) => {
  try {
    const result = await provisioning.stopVm({ username: req.session.user.username });
    res.json(result);
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

// ---- Administration (nur AUTHENTIK_ADMIN_GROUP) -----------------------

app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await ldap.listUsers(config));
  } catch (err) {
    res.status(502).json({ error: `LDAP-Abfrage fehlgeschlagen: ${err.message}` });
  }
});

app.get('/api/sessions', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await provisioning.listSessions());
  } catch (err) {
    res.status(502).json({ error: `Kasm-Abfrage fehlgeschlagen: ${err.message}` });
  }
});

app.get('/api/vms', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await provisioning.listAllVms());
  } catch (err) {
    res.status(502).json({ error: `Proxmox-Abfrage fehlgeschlagen: ${err.message}` });
  }
});

app.post('/api/vms/provision', requireAuth, requireAdmin, provisionLimiter, async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username fehlt' });
  try {
    res.json(await provisioning.requestVm(username));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

app.delete('/api/vms/:vmid', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await provisioning.stopVm({ vmid: Number(req.params.vmid) }));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

app.use(notFound);
app.use(buildErrorHandler(logger));

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Dashboard läuft');
  });
}

module.exports = { app };
