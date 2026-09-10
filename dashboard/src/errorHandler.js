// errorHandler.js
//
// Zentrale Fehlerbehandlung: fängt alles ab, was per next(err) aus den
// Routen kommt (z.B. aus dem OIDC-Auth-Router), loggt strukturiert über
// pino und antwortet ohne Stacktrace. Für /api kommt JSON zurück, sonst
// eine schlichte HTML-Seite.

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Nicht gefunden.' });
  }
  return next();
}

function buildErrorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    logger.error(
      { err: err.message, stack: err.stack, method: req.method, path: req.path },
      'Unbehandelter Fehler'
    );
    if (res.headersSent) return;

    const status = err.status || err.statusCode || 500;

    if (req.path.startsWith('/api/')) {
      return res.status(status).json({ error: 'Interner Fehler.' });
    }

    res
      .status(status)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>Fehler</title>' +
          '<div style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
          '<h1 style="font-size:1.25rem">Es ist ein Fehler aufgetreten</h1>' +
          '<p>Bitte erneut anmelden oder den Administrator kontaktieren.</p>' +
          '<p><a href="/auth/login">Zur Anmeldung</a></p></div>'
      );
  };
}

module.exports = { notFound, buildErrorHandler };
