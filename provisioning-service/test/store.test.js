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
  assert.deepEqual(store.read(), {
    vms: {},
    audit: [],
    history: [],
    announcement: { text: '', level: 'info', updatedAt: null },
    settings: {},
  });
});

test('StateStore.read migriert eine alte state.json (nur { vms }) sanft', () => {
  const p = tempStatePath();
  fs.writeFileSync(p, JSON.stringify({ vms: { 7: { vmid: 7, status: 'pool' } } }));
  const store = new StateStore(p);
  const data = store.read();
  assert.equal(data.vms[7].status, 'pool');
  assert.deepEqual(data.audit, []);
  assert.deepEqual(data.history, []);
  assert.equal(data.announcement.level, 'info');
});

test('StateStore.appendAudit begrenzt die Liste auf MAX_AUDIT', async () => {
  const store = new StateStore(tempStatePath());
  for (let i = 0; i < StateStore.MAX_AUDIT + 25; i++) {
    await store.appendAudit({ ts: new Date().toISOString(), action: 'test', actor: 'x', detail: i });
  }
  const audit = store.read().audit;
  assert.equal(audit.length, StateStore.MAX_AUDIT);
  assert.equal(audit[audit.length - 1].detail, StateStore.MAX_AUDIT + 24);
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
