// shared/retry.js
//
// Kleiner Retry-Helfer mit exponentiellem Backoff für Netzwerkaufrufe, die
// bei kurzen Aussetzern (Proxmox/Kasm kurz nicht erreichbar) einfach
// nochmal versucht werden sollen, statt die ganze Provisioning-Kette
// sofort abbrechen zu lassen.
//
// WICHTIG: Nur auf Aufrufe anwenden, die bei Wiederholung keinen Schaden
// anrichten (z.B. Status abfragen, VM-Liste holen). Ein erneutes Klonen
// nach einem Timeout könnte im ungünstigsten Fall eine zweite VM anlegen,
// wenn der erste Versuch tatsächlich durchgelaufen ist, aber nur die
// Antwort verloren ging - das ist hier bewusst in Kauf genommen und an
// den jeweiligen Aufrufstellen kommentiert.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, options = {}) {
  const { retries = 3, delayMs = 1000, factor = 2, logger, label = 'Aufruf' } = options;
  let attempt = 0;
  let delay = delayMs;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries) {
        throw err;
      }
      if (logger) {
        logger.warn(
          { attempt, retries, delayMs: delay, err: err.message },
          `${label} fehlgeschlagen, versuche es in ${delay}ms erneut`
        );
      }
      await sleep(delay);
      delay *= factor;
    }
  }
}

module.exports = { withRetry, sleep };
