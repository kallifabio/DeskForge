// sessionStore.js
//
// Baut die express-session-Middleware. Wenn REDIS_URL gesetzt ist,
// werden die Sitzungen in Redis abgelegt (überlebt Neustarts, kein
// Speicherleck, tauglich für mehrere Instanzen). Ohne REDIS_URL fällt
// das Dashboard auf den In-Memory-Store zurück - im Produktivbetrieb
// wird dann gewarnt.

const session = require('express-session');

// Muss mit dem Namen in auth.js (/auth/logout -> res.clearCookie) übereinstimmen.
const COOKIE_NAME = 'deskforge.sid';

function buildSessionMiddleware(config, logger) {
  const isProd = config.nodeEnv === 'production';

  const base = {
    name: COOKIE_NAME,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd, // nur über HTTPS ausliefern; lokal (http) sonst nie gesetzt
      maxAge: 8 * 60 * 60 * 1000,
    },
  };

  if (config.redisUrl) {
    const { RedisStore } = require('connect-redis');
    const { createClient } = require('redis');
    const client = createClient({ url: config.redisUrl });
    client.on('error', (err) => logger.error({ err: err.message }, 'Redis-Fehler'));
    client
      .connect()
      .then(() => logger.info('Session-Store: Redis verbunden'))
      .catch((err) => logger.error({ err: err.message }, 'Redis-Verbindung fehlgeschlagen'));
    return session({
      ...base,
      store: new RedisStore({ client, prefix: 'deskforge:sess:' }),
    });
  }

  if (isProd) {
    logger.warn(
      'Kein REDIS_URL gesetzt - Sitzungen liegen nur im Arbeitsspeicher. ' +
        'Nicht für Produktion oder Mehr-Instanz-Betrieb geeignet.'
    );
  }
  return session(base);
}

module.exports = { buildSessionMiddleware, COOKIE_NAME };
