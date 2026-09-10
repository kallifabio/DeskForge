// lib/ldap.js
// Read-only Abfrage der Benutzerliste aus OpenLDAP für die Übersicht im
// Dashboard. Nutzt "ldapts" (aktiv gepflegt) statt des seit 2024
// offiziell eingestellten "ldapjs".

const { Client } = require('ldapts');

// ldapts liefert Attribute je nach Server als String, als Array von
// Strings oder als Buffer. Auf einen sauberen String normalisieren.
function first(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return '';
  return Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
}

async function listUsers(config) {
  const client = new Client({
    url: config.ldap.url,
    timeout: 5000, // Timeout je Operation
    connectTimeout: 5000, // Timeout für den Verbindungsaufbau
  });

  try {
    await client.bind(config.ldap.bindDn, config.ldap.bindPassword);

    const { searchEntries } = await client.search(config.ldap.baseDn, {
      filter: '(objectClass=inetOrgPerson)',
      scope: 'sub',
      attributes: ['uid', 'cn', 'mail'],
    });

    return searchEntries.map((entry) => ({
      uid: first(entry.uid),
      name: first(entry.cn),
      email: first(entry.mail),
    }));
  } finally {
    try {
      await client.unbind();
    } catch (_) {
      /* Verbindung ggf. schon weg - unkritisch */
    }
  }
}

module.exports = { listUsers };
