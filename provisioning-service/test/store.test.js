const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../src/state/store');

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vdi-state-')), 'state.json');
}

test('StateStore legt eine leere Datei an, falls noch keine existiert', () => {
  const store = new StateStore(tempStatePath());
  assert.deepEqual(store.read(), { vms: {} });
});

test('StateStore.update persistiert Änderungen', async () => {
  const store = new StateStore(tempStatePath());
  await store.update((data) => {
    data.vms[123] = { vmid: 123, status: 'pool' };
  });
  assert.equal(store.read().vms[123].status, 'pool');
});

test('StateStore.update serialisiert gleichzeitige Schreibzugriffe ohne verlorene Updates', async () => {
  const store = new StateStore(tempStatePath());
  await store.update((data) => {
    data.counter = 0;
  });

  // 50 "lese aktuellen Wert, erhöhe um 1, schreibe zurück"-Operationen
  // gleichzeitig anstoßen - ohne Serialisierung würden Updates verloren
  // gehen, weil mehrere Reads denselben alten Stand sehen.
  await Promise.all(
    Array.from({ length: 50 }, () =>
      store.update((data) => {
        data.counter += 1;
      })
    )
  );

  assert.equal(store.read().counter, 50);
});
