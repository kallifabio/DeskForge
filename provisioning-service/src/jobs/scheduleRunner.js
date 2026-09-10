// jobs/scheduleRunner.js
//
// Arbeitet fällige geplante Anforderungen (schedules[] im State Store)
// ab: sobald notBefore erreicht ist, wird eine VM angefordert - über
// einen ganz normalen HTTP-Aufruf an das eigene /provision, damit die
// komplette Prüf-/Zuweisungslogik (Templates, Pool, Kasm-Registrierung)
// wiederverwendet wird, statt sie hier zu duplizieren.

const axios = require('axios');

async function runDueSchedules({ store, config, logger }) {
  const now = Date.now();
  const due = store.read().schedules.filter(
    (s) => s.status === 'pending' && Date.parse(s.notBefore) <= now
  );
  if (!due.length) return;

  const base = `http://127.0.0.1:${config.port}`;
  for (const s of due) {
    logger.info({ id: s.id, username: s.username, template: s.template }, 'Arbeite geplante Anforderung ab');
    try {
      const res = await axios.post(
        `${base}/provision`,
        { username: s.username, template: s.template },
        { headers: { 'X-API-Key': config.provisioningApiKey, 'X-Actor': 'system:schedule' }, timeout: 15 * 60_000 }
      );
      await markSchedule(store, s.id, { status: 'done', result: { vmid: res.data.vmid, ip: res.data.ip } });
    } catch (err) {
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      logger.error({ id: s.id, err: detail }, 'Geplante Anforderung fehlgeschlagen');
      await markSchedule(store, s.id, { status: 'failed', error: detail });
    }
  }
}

async function markSchedule(store, id, patch) {
  await store.update((d) => {
    const s = d.schedules.find((x) => x.id === id);
    if (s) Object.assign(s, patch, { ranAt: new Date().toISOString() });
  });
}

function startScheduleRunner(deps) {
  const run = () =>
    runDueSchedules(deps).catch((err) =>
      deps.logger.error({ err: err.message }, 'Schedule-Runner-Durchlauf fehlgeschlagen')
    );
  run();
  return setInterval(run, deps.config.scheduleCheckIntervalMs);
}

module.exports = { runDueSchedules, startScheduleRunner };
