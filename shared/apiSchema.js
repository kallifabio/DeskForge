// shared/apiSchema.js
//
// Gemeinsame Datenformen zwischen Provisioning-Service und Dashboard.
// Bewusst OHNE zod-Import (shared/ hat keine eigenen node_modules) -
// stattdessen schlanke, hand-geschriebene Validierer/Normalisierer, die
// aus beiden Services heraus per relativem require() nutzbar sind.
//
// Die Funktionen sind defensiv: unbekannte Felder werden durchgereicht,
// fehlende Felder bekommen sinnvolle Defaults. So bleibt das Dashboard
// robust, falls der Provisioning-Service mal ein Feld mehr oder weniger
// liefert.

const VM_STATUSES = ['pool', 'claiming', 'assigned', 'deprovisioning'];

// Baut die öffentliche VM-Sicht fürs Dashboard aus einem State-Store-
// Eintrag. `opts.kasmBaseUrl` / `opts.kasmWorkspaceId` steuern den
// Deep-Link, `opts.idleTimeoutMinutes` den Reap-Zeitpunkt.
function toPublicVm(vm, opts = {}) {
  if (!vm) return null;
  const { kasmBaseUrl, kasmWorkspaceId, idleTimeoutMinutes } = opts;

  const idleSince = vm.idleSince || vm.lastActiveCheck || vm.assignedAt || null;
  const keepaliveUntil = vm.keepaliveUntil || null;

  let reapAt = null;
  if (vm.status === 'assigned' && idleSince && idleTimeoutMinutes) {
    const base = keepaliveUntil
      ? new Date(keepaliveUntil).getTime()
      : new Date(idleSince).getTime() + idleTimeoutMinutes * 60_000;
    reapAt = new Date(base).toISOString();
  }

  return {
    vmid: vm.vmid,
    name: vm.name || null,
    status: vm.status,
    username: vm.username || null,
    ip: vm.ip || null,
    createdAt: vm.createdAt || null,
    assignedAt: vm.assignedAt || null,
    idleSince,
    keepaliveUntil,
    reapAt,
    kasmServerId: vm.kasmServerId || null,
    connectUrl: buildConnectUrl(vm, kasmBaseUrl, kasmWorkspaceId),
  };
}

// Kasm-Deep-Link. Ohne server-spezifische Launch-API bringt uns der
// Workspace-/Staging-Screen am nächsten an "ein Klick -> Desktop".
function buildConnectUrl(vm, kasmBaseUrl, kasmWorkspaceId) {
  if (!kasmBaseUrl || vm.status !== 'assigned') return null;
  const base = String(kasmBaseUrl).replace(/\/+$/, '');
  if (kasmWorkspaceId) return `${base}/#/launch/${encodeURIComponent(kasmWorkspaceId)}`;
  if (vm.kasmServerId) return `${base}/#/staging?server_id=${encodeURIComponent(vm.kasmServerId)}`;
  return `${base}/`;
}

// Ein Audit-Eintrag. `actor` ist der auslösende Nutzer (oder "system").
function auditEntry({ action, actor, vmid = null, username = null, detail = null }) {
  return {
    ts: new Date().toISOString(),
    action,
    actor: actor || 'system',
    vmid,
    username,
    detail,
  };
}

// Minimaler Payload-Check für "Pool-Größe setzen".
function parsePoolPatch(body) {
  const size = Number(body && body.size);
  if (!Number.isInteger(size) || size < 0 || size > 50) {
    return { ok: false, error: 'size muss eine ganze Zahl zwischen 0 und 50 sein' };
  }
  return { ok: true, value: { size } };
}

// Payload-Check fürs Ankündigungsbanner.
function parseAnnouncement(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const level = ['info', 'warning', 'critical'].includes(body?.level) ? body.level : 'info';
  if (text.length > 500) return { ok: false, error: 'text darf höchstens 500 Zeichen lang sein' };
  return { ok: true, value: { text, level, updatedAt: new Date().toISOString() } };
}

module.exports = {
  VM_STATUSES,
  toPublicVm,
  buildConnectUrl,
  auditEntry,
  parsePoolPatch,
  parseAnnouncement,
};
