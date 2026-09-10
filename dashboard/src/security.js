// security.js
//
// - buildHelmet(): setzt Sicherheits-HTTP-Header inkl. einer strengen
//   Content-Security-Policy. Das Frontend lädt ausschließlich eigene
//   Ressourcen (Tailwind, selbst gehostetes Font Awesome, app.js), daher
//   'self' überall; kein CDN, keine Inline-Skripte.
// - csrfOriginGuard(): einfacher CSRF-Schutz für verändernde /api-Aufrufe.
//   Browser senden bei POST/PUT/PATCH/DELETE einen Origin-Header; wir
//   lassen nur den eigenen Ursprung (bzw. PUBLIC_URL) durch. Reicht für
//   eine reine Fetch-API ohne Formular-Submits von fremden Seiten.

const helmet = require('helmet');

function buildHelmet() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'script-src': ["'self'"],
        // 'unsafe-inline' nur für Styles: SweetAlert2 setzt zur Laufzeit
        // inline style-Attribute (Animationen, Timerbalken), und der
        // <style>-Block im <head> braucht es ebenfalls. script-src bleibt
        // streng ('self'), das ist der für XSS entscheidende Vektor.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        // deaktiviert - würde lokalen http-Betrieb (localhost) brechen:
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfOriginGuard(config) {
  const allowed = new Set();
  if (config.publicUrl) {
    try {
      allowed.add(new URL(config.publicUrl).origin);
    } catch (_) {
      /* ungültige PUBLIC_URL wird von config.js bereits abgefangen */
    }
  }

  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();

    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    let source = req.get('origin');
    if (!source && req.get('referer')) {
      try {
        source = new URL(req.get('referer')).origin;
      } catch (_) {
        source = null;
      }
    }

    if (!source) {
      return res.status(403).json({ error: 'Ursprung fehlt (CSRF-Schutz).' });
    }
    if (source === selfOrigin || allowed.has(source)) return next();
    return res.status(403).json({ error: 'Ungültiger Ursprung (CSRF-Schutz).' });
  };
}

module.exports = { buildHelmet, csrfOriginGuard };
