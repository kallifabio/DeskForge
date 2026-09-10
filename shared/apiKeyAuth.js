// shared/apiKeyAuth.js
//
// Express-Middleware, die einen gemeinsamen API-Key zwischen Dashboard und
// Provisioning-Service verlangt. Ohne das könnte jeder mit Netzwerkzugriff
// auf den Provisioning-Service beliebig VMs anfordern oder abbauen.
//
// Ersetzt keine Netzwerk-Firewall - beides zusammen (Firewall + API-Key)
// ist die empfohlene Kombination, siehe docs/SETUP.md.

function requireApiKey(expectedKey) {
  return (req, res, next) => {
    const provided = req.header('X-API-Key');
    if (!expectedKey) {
      // Fehlkonfiguration: ohne konfigurierten Key lieber hart ablehnen,
      // als versehentlich offen zu laufen.
      return res.status(500).json({ error: 'PROVISIONING_API_KEY ist serverseitig nicht konfiguriert' });
    }
    if (!provided || provided !== expectedKey) {
      return res.status(401).json({ error: 'Ungültiger oder fehlender API-Key (X-API-Key-Header)' });
    }
    next();
  };
}

module.exports = { requireApiKey };
