// shared/mutex.js
//
// Einfacher In-Process-Mutex, um kritische Abschnitte zu serialisieren -
// konkret genutzt, um die Proxmox-VMID-Vergabe race-condition-frei zu
// machen: zwei gleichzeitige Provisioning-Anfragen dürfen sich nicht
// dieselbe VMID greifen.
//
// EINSCHRÄNKUNG: Das funktioniert nur innerhalb EINES Node-Prozesses.
// Läuft der Provisioning-Service mehrfach parallel (z.B. hinter einem
// Load Balancer), schützt dieser Mutex nicht mehr - dafür bräuchte es
// eine verteilte Sperre (z.B. über Redis oder Proxmox selbst). Für dieses
// Projekt wird bewusst von genau einer laufenden Instanz ausgegangen.

class Mutex {
  constructor() {
    this._locked = false;
    this._queue = [];
  }

  acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => this._release());
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  _release() {
    this._locked = false;
    const next = this._queue.shift();
    if (next) next();
  }
}

module.exports = { Mutex };
