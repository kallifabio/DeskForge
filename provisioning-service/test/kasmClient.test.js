const test = require('node:test');
const assert = require('node:assert/strict');
const { KasmClient } = require('../../shared/kasmClient');

// Baut einen Fake-Axios mit einer konfigurierbaren post()-Implementierung,
// damit KasmClient ohne echten Netzwerkzugriff getestet werden kann.
function fakeAxios(postImpl) {
  return { post: postImpl };
}

test('getServerRegistrationToken findet das Token unabhängig vom Feldnamen', async () => {
  for (const field of ['agent_registration_token', 'registration_token', 'token']) {
    const client = new KasmClient(
      fakeAxios(async (url) => {
        if (url === '/api/admin/get_servers') {
          return { data: { servers: [{ server_id: 'abc', [field]: 'geheimes-token' }] } };
        }
        throw new Error(`unerwarteter Aufruf: ${url}`);
      }),
      { apiKey: 'k', apiKeySecret: 's' }
    );
    const token = await client.getServerRegistrationToken('abc');
    assert.equal(token, 'geheimes-token', `Feld ${field} sollte erkannt werden`);
  }
});

test('getServerRegistrationToken wirft eine verständliche Fehlermeldung, wenn kein bekanntes Feld existiert', async () => {
  const client = new KasmClient(
    fakeAxios(async () => ({ data: { servers: [{ server_id: 'abc', irgendein_anderes_feld: 'x' }] } })),
    { apiKey: 'k', apiKeySecret: 's' }
  );
  await assert.rejects(() => client.getServerRegistrationToken('abc'), /Kein bekanntes Token-Feld/);
});

test('getServerRegistrationToken wirft, wenn die server_id nicht existiert', async () => {
  const client = new KasmClient(
    fakeAxios(async () => ({ data: { servers: [] } })),
    { apiKey: 'k', apiKeySecret: 's' }
  );
  await assert.rejects(() => client.getServerRegistrationToken('unbekannt'), /nicht in get_servers-Antwort gefunden/);
});

test('createServer sendet die konfigurierten Limits mit', async () => {
  let capturedBody;
  const client = new KasmClient(
    fakeAxios(async (url, body) => {
      capturedBody = body;
      return { data: { server_id: 'neu-123' } };
    }),
    { apiKey: 'k', apiKeySecret: 's', maxSimultaneousSessions: 2, maxSimultaneousUsers: 3 }
  );
  const id = await client.createServer({ name: 'vdi-test', ip: '10.0.0.5', zoneId: 'zone-1' });
  assert.equal(id, 'neu-123');
  assert.equal(capturedBody.target_server.max_simultaneous_sessions, 2);
  assert.equal(capturedBody.target_server.max_simultaneous_users, 3);
  assert.equal(capturedBody.api_key, 'k');
});

test('getSessions unterstützt sowohl {kasms: [...]} als auch ein rohes Array', async () => {
  const clientA = new KasmClient(fakeAxios(async () => ({ data: { kasms: [{ id: 1 }] } })), { apiKey: 'k', apiKeySecret: 's' });
  assert.deepEqual(await clientA.getSessions(), [{ id: 1 }]);

  const clientB = new KasmClient(fakeAxios(async () => ({ data: [{ id: 2 }] })), { apiKey: 'k', apiKeySecret: 's' });
  assert.deepEqual(await clientB.getSessions(), [{ id: 2 }]);
});
