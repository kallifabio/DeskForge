// state/store.js
//
// Persistenter Zustand des Provisioning-Service: welche VMs existieren,
// wem sie zugewiesen sind, welche im Pool auf Zuweisung warten. Wird als
// einfache JSON-Datei gespeichert - für die Größenordnung dieses Projekts
// (eine Handvoll bis einige Dutzend VMs) völlig ausreichend, ohne eine
// separate Datenbank zu brauchen.
//
// Schreibzugriffe werden über eine Promise-Kette serialisiert
// (this._writeQueue), damit zwei gleichzeitige Aktualisierungen sich
// nicht gegenseitig überschreiben ("lost update").

const fs = require('fs');
const path = require('path');

class StateStore {
  constructor(filePath, logger) {
    this.filePath = filePath;
    this.logger = logger;
    this._writeQueue = Promise.resolve();
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ vms: {} }, null, 2));
    }
  }

  read() {
    const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    // Sanfte Migration: ältere state.json-Dateien haben nur { vms }.
    if (!raw.vms) raw.vms = {};
    if (!Array.isArray(raw.audit)) raw.audit = [];
    if (!Array.isArray(raw.history)) raw.history = [];
    if (typeof raw.announcement !== 'object' || raw.announcement === null) {
      raw.announcement = { text: '', level: 'info', updatedAt: null };
    }
    if (typeof raw.settings !== 'object' || raw.settings === null) {
      raw.settings = {}; // z.B. { poolSizeOverride: <int> }
    }
    if (!Array.isArray(raw.apiTokens)) raw.apiTokens = [];
    if (!Array.isArray(raw.schedules)) raw.schedules = [];
    return raw;
  }

  // Hängt einen Audit-Eintrag an und begrenzt die Liste auf die letzten
  // MAX_AUDIT Einträge (die state.json soll nicht unbegrenzt wachsen).
  async appendAudit(entry) {
    return this.update((data) => {
      data.audit.push(entry);
      if (data.audit.length > StateStore.MAX_AUDIT) {
        data.audit = data.audit.slice(-StateStore.MAX_AUDIT);
      }
    });
  }

  // Sitzungs-Historie (eine Zeile je abgebauter Zuweisung).
  async appendHistory(entry) {
    return this.update((data) => {
      data.history.push(entry);
      if (data.history.length > StateStore.MAX_HISTORY) {
        data.history = data.history.slice(-StateStore.MAX_HISTORY);
      }
    });
  }

  _writeSync(data) {
    // Erst in temporäre Datei schreiben, dann atomar umbenennen - schützt
    // vor einer beschädigten state.json, falls der Prozess mitten im
    // Schreiben abstürzt.
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  // Serialisiertes Read-Modify-Write. `mutator` bekommt das aktuelle
  // Datenobjekt, verändert es direkt (oder gibt einen Rückgabewert
  // zurück) - der veränderte Stand wird danach geschrieben.
  async update(mutator) {
    const task = this._writeQueue.then(async () => {
      const data = this.read();
      const result = await mutator(data);
      this._writeSync(data);
      return result;
    });
    // Folgefehler dürfen die Warteschlange nicht dauerhaft blockieren.
    this._writeQueue = task.catch((err) => {
      if (this.logger) this.logger.error({ err: err.message }, 'Fehler beim Schreiben des State Stores');
    });
    return task;
  }
}

StateStore.MAX_AUDIT = 1000;
StateStore.MAX_HISTORY = 1000;

module.exports = { StateStore };
