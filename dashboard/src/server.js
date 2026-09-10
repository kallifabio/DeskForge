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
    const result = await provisioning.stopVm(
      { username: req.session.user.username },
      req.session.user.username
    );
    res.json(result);
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

// Idle-Timer zurücksetzen ("Sitzung verlängern").
app.post('/api/my-vm/keepalive', requireAuth, async (req, res) => {
  try {
    res.json(await provisioning.keepAlive(req.session.user.username, req.session.user.username));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

// Weicher Neustart der eigenen VM.
app.post('/api/my-vm/reboot', requireAuth, provisionLimiter, async (req, res) => {
  try {
    res.json(await provisioning.rebootMyVm(req.session.user.username, req.session.user.username));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

app.get('/api/my-history', requireAuth, async (req, res) => {
  try {
    res.json(await provisioning.myHistory(req.session.user.username));
  } catch (err) {
    res.status(502).json({ error: `Historie nicht abrufbar: ${err.message}` });
  }
});

// Ankündigungsbanner: lesen darf jeder angemeldete Nutzer.
app.get('/api/announcement', requireAuth, async (_req, res) => {
  try {
    res.json(await provisioning.getAnnouncement());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Live-Updates (Server-Sent Events) -------------------------------

async function buildEventPayload(user) {
  const [myVm, announcement] = await Promise.allSettled([
    provisioning.getMyVm(user.username),
    provisioning.getAnnouncement(),
  ]);
  const payload = {
    ts: new Date().toISOString(),
    myVm: myVm.status === 'fulfilled' ? myVm.value : null,
    announcement: announcement.status === 'fulfilled' ? announcement.value : null,
  };
  if (user.isAdmin) {
    const [vms, status, capacity] = await Promise.allSettled([
      provisioning.listAllVms(),
      provisioning.deepStatus(),
      provisioning.capacity(),
    ]);
    payload.admin = {
      vms: vms.status === 'fulfilled' ? vms.value : null,
      status: status.status === 'fulfilled' ? status.value : null,
      capacity: capacity.status === 'fulfilled' ? capacity.value : null,
    };
  }
  return payload;
}

app.get('/api/events', requireAuth, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const user = req.session.user;
  let closed = false;

  const push = async () => {
    if (closed) return;
    try {
      const payload = await buildEventPayload(user);
      res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  };

  await push();
  const dataInterval = setInterval(push, 5000);
  const keepAliveInterval = setInterval(() => {
    if (!closed) res.write(': keepalive\n\n');
  }, 25000);

  req.on('close', () => {
    closed = true;
    clearInterval(dataInterval);
    clearInterval(keepAliveInterval);
  });
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
    res.json(await provisioning.requestVm(username, req.session.user.username));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

app.delete('/api/vms/:vmid', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await provisioning.stopVm({ vmid: Number(req.params.vmid) }, req.session.user.username));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

// ---- Admin: Audit, Kapazität, System-Status, Pool, Ankündigung -------

app.get('/api/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await provisioning.listAudit({ limit: req.query.limit, before: req.query.before }));
  } catch (err) {
    res.status(502).json({ error: `Audit-Log nicht abrufbar: ${err.message}` });
  }
});

app.get('/api/capacity', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await provisioning.capacity());
  } catch (err) {
    res.status(502).json({ error: `Kapazität nicht abrufbar: ${err.message}` });
  }
});

app.get('/api/status', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await provisioning.deepStatus());
  } catch (err) {
    res.status(502).json({ error: `System-Status nicht abrufbar: ${err.message}` });
  }
});

app.get('/api/pool', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await provisioning.getPool());
  } catch (err) {
    res.status(502).json({ error: `Pool-Info nicht abrufbar: ${err.message}` });
  }
});

app.patch('/api/pool', requireAuth, requireAdmin, async (req, res) => {
  const size = Number(req.body && req.body.size);
  try {
    res.json(await provisioning.setPool(size, req.session.user.username));
  } catch (err) {
    const detail = err.response ? err.response.data : { error: err.message };
    res.status(err.response?.status || 502).json(detail);
  }
});

app.put('/api/announcement', requireAuth, requireAdmin, async (req, res) => {
  const { text, level } = req.body || {};
  try {
    res.json(await provisioning.setAnnouncement({ text, level }, req.session.user.username));
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
