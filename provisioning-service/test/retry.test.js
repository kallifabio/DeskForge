const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry } = require('../../shared/retry');

test('withRetry gibt beim ersten Erfolg sofort zurück', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry versucht es nach Fehlschlägen erneut und gibt dann den Erfolg zurück', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('vorübergehender Fehler');
      return 'endlich ok';
    },
    { retries: 5, delayMs: 1 }
  );
  assert.equal(result, 'endlich ok');
  assert.equal(calls, 3);
});

test('withRetry gibt nach Erreichen des Limits den letzten Fehler weiter', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`Fehler Nr. ${calls}`);
        },
        { retries: 2, delayMs: 1 }
      ),
    /Fehler Nr. 3/
  );
  assert.equal(calls, 3); // 1 Erstversuch + 2 Wiederholungen
});
