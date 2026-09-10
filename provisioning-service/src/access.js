// access.js
//
// Lädt die optionale Zugriffs-/Template-Konfiguration
// (provisioning-service/access.json) und bietet Helfer, um pro
// Nutzer(gruppe) zu entscheiden:
//   - welche VM-Templates ("Größen") angefordert werden dürfen
//   - wie viele VMs ein Nutzer gleichzeitig haben darf (Kontingent)
//
// Fehlt die Datei, gibt es genau ein implizites Template "standard"
// (PROXMOX_TEMPLATE_VMID aus der .env) und das Kontingent aus
// DEFAULT_MAX_CONCURRENT. So bleibt das Setup ohne access.json lauffähig.
//
// Format von access.json:
// {
//   "templates": {
//     "standard": { "templateVmid": 9000, "label": "Standard", "default": true },
//     "dev":      { "templateVmid": 9001, "label": "Entwicklung" }
//   },
//   "groups": {
//     "deskforge-admins": { "templates": ["*"], "maxConcurrent": 10 },
//     "deskforge-dev":    { "templates": ["standard", "dev"], "maxConcurrent": 2 },
//     "*":                { "templates": ["standard"], "maxConcurrent": 1 }
//   }
// }

const fs = require('fs');

function loadAccess(filePath, config, logger) {
  let raw = null;
  try {
    if (filePath && fs.existsSync(filePath)) {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    if (logger) logger.error({ err: err.message, filePath }, 'access.json konnte nicht gelesen werden - nutze Defaults');
    raw = null;
  }

  const fallbackMax = Number.isInteger(config.defaultMaxConcurrent)
    ? config.defaultMaxConcurrent
    : 1;

  // Templates: aus Datei oder implizites "standard".
  const templates =
    raw && raw.templates && Object.keys(raw.templates).length
      ? { ...raw.templates }
      : { standard: { templateVmid: config.proxmox.templateVmid, label: 'Standard', default: true } };

  // Genau ein Default-Template bestimmen.
  let defaultName =
    Object.keys(templates).find((n) => templates[n] && templates[n].default) ||
    Object.keys(templates)[0];

  const groups = (raw && raw.groups) || {};
  const wildcardRule = groups['*'] || { templates: [defaultName], maxConcurrent: fallbackMax };

  function templateExists(name) {
    return Object.prototype.hasOwnProperty.call(templates, name);
  }

  function templateVmid(name) {
    if (!templateExists(name)) throw new Error(`Unbekanntes Template "${name}"`);
    return templates[name].templateVmid;
  }

  // Vereinigt die Regeln aller Gruppen des Nutzers: erlaubte Templates =
  // Vereinigungsmenge, Kontingent = größter Wert (großzügigste Gruppe
  // gewinnt). Ohne passende Gruppe greift die "*"-Regel.
  function resolveForGroups(userGroups = []) {
    const applicable = userGroups.filter((g) => groups[g]);
    if (!applicable.length) {
      return normalizeRule(wildcardRule);
    }
    let maxConcurrent = 0;
    const allowed = new Set();
    let all = false;
    for (const g of applicable) {
      const r = normalizeRule(groups[g]);
      maxConcurrent = Math.max(maxConcurrent, r.maxConcurrent);
      if (r.allowsAll) all = true;
      r.templates.forEach((t) => allowed.add(t));
    }
    return { allowsAll: all, templates: [...allowed], maxConcurrent };
  }

  function normalizeRule(rule) {
    const list = Array.isArray(rule.templates) ? rule.templates : [defaultName];
    const allowsAll = list.includes('*');
    return {
      allowsAll,
      templates: allowsAll ? Object.keys(templates) : list.filter(templateExists),
      maxConcurrent: Number.isInteger(rule.maxConcurrent) ? rule.maxConcurrent : fallbackMax,
    };
  }

  function canUseTemplate(userGroups, name) {
    if (!templateExists(name)) return false;
    const r = resolveForGroups(userGroups);
    return r.allowsAll || r.templates.includes(name);
  }

  // Für die Template-Auswahl im Dashboard.
  function templatesForGroups(userGroups) {
    const r = resolveForGroups(userGroups);
    const names = r.allowsAll ? Object.keys(templates) : r.templates;
    return names.map((n) => ({
      name: n,
      label: templates[n].label || n,
      default: n === defaultName,
    }));
  }

  return {
    fromFile: Boolean(raw),
    templateNames: Object.keys(templates),
    defaultTemplate: () => defaultName,
    templateExists,
    templateVmid,
    resolveForGroups,
    canUseTemplate,
    templatesForGroups,
  };
}

// "alice,bob" / ["alice","bob"] -> ["alice","bob"]
function parseGroupsHeader(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { loadAccess, parseGroupsHeader };
