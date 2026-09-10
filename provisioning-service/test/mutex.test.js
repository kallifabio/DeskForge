const test = require('node:test');
const assert = require('node:assert/strict');
const { Mutex } = require('../../shared/mutex');

test('Mutex serialisiert gleichzeitige Zugriffe', async () => {
  const mutex = new Mutex();
  const order = [];

  async function task(id, delayMs) {
    const release = await mutex.acquire();
    order.push(`start-${id}`);
    await new Promise((r) => setTimeout(r, delayMs));
    order.push(`end-${id}`);
    release();
  }

  // Task 1 startet zuerst und hält die Sperre kurz - Task 2 und 3 müssen
  // warten und dürfen sich NICHT überlappen.
  const p1 = task(1, 30);
  const p2 = task(2, 10);
  const p3 = task(3, 5);

  await Promise.all([p1, p2, p3]);

  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
});

test('Mutex gibt nach Freigabe den nächsten Wartenden frei', async () => {
  const mutex = new Mutex();
  const release1 = await mutex.acquire();

  let acquired2 = false;
  const p2 = mutex.acquire().then((release2) => {
    acquired2 = true;
    release2();
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(acquired2, false, 'zweiter Zugriff darf noch nicht erfolgt sein');

  release1();
  await p2;
  assert.equal(acquired2, true);
});
