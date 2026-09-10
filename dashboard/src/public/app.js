// app.js - Frontend-Logik des Dashboards.
//
// Live-Aktualisierung läuft über Server-Sent Events (/api/events). Bricht
// die SSE-Verbindung, wird automatisch auf einfaches Polling
// zurückgefallen und regelmäßig ein SSE-Neuversuch unternommen.

// ---- kleine Helfer -------------------------------------------------

function esc(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch (_) { /* leerer Body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Fehler bei ${url}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE');
}

// "in 12 Min", "vor 3 Std", ...
function relTime(iso) {
  if (!iso) return '';
  const deltaSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const fmt = (n, unit) => `${n} ${unit}`;
  let text;
  if (abs < 60) text = fmt(abs, 'Sek.');
  else if (abs < 3600) text = fmt(Math.round(abs / 60), 'Min.');
  else if (abs < 86400) text = fmt(Math.round(abs / 3600), 'Std.');
  else text = fmt(Math.round(abs / 86400), 'Tage');
  return deltaSec >= 0 ? `in ${text}` : `vor ${text}`;
}

function rowError(colspan, message) {
  return `<tr><td colspan="${colspan}" class="py-3 text-rose-400"><i class="fa-solid fa-triangle-exclamation mr-2"></i>${esc(message)}</td></tr>`;
}
function rowEmpty(colspan, message) {
  return `<tr><td colspan="${colspan}" class="py-3 text-slate-500">${esc(message)}</td></tr>`;
}
function rowLoading(colspan) {
  return `<tr><td colspan="${colspan}" class="py-3 text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Lädt...</td></tr>`;
}

function notify(title, body) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch (_) { /* egal */ }
}

// ---- Farbschema --------------------------------------------------

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('deskforge-theme'); } catch (_) {}
  if (saved === 'light') document.documentElement.classList.add('theme-light');
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const light = document.documentElement.classList.toggle('theme-light');
  try { localStorage.setItem('deskforge-theme', light ? 'light' : 'dark'); } catch (_) {}
});

// ---- Zustand ---------------------------------------------------

let currentUser = null;
let lastVmStatus = null; // um den Übergang -> "assigned" zu erkennen
let currentReapAt = null;

// ---- Selbstbedienungs-Karte ----------------------------------

const el = (id) => document.getElementById(id);

function renderMyVm(vm) {
  const statusEl = el('myVmStatus');
  const idleEl = el('idleInfo');
  const show = (id, on) => { el(id).hidden = !on; };

  const status = vm ? vm.status : 'none';

  if (status === 'assigned' && lastVmStatus && lastVmStatus !== 'assigned') {
    notify('VDI-Sitzung bereit', `Deine VM ${vm.vmid} läuft (IP ${vm.ip}).`);
  }
  lastVmStatus = status;

  if (!vm) {
    statusEl.innerHTML = '<i class="fa-solid fa-circle-info mr-2"></i>Aktuell keine VM zugewiesen.';
    currentReapAt = null;
    idleEl.hidden = true;
    ['connectBtn', 'extendBtn', 'rebootBtn', 'stopVmBtn'].forEach((id) => show(id, false));
    show('requestVmBtn', true);
    return;
  }

  if (status === 'claiming' || status === 'deprovisioning') {
    const label = status === 'claiming' ? 'wird vorbereitet' : 'wird abgebaut';
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i>VM ${label}...`;
    currentReapAt = null;
    idleEl.hidden = true;
    ['connectBtn', 'extendBtn', 'rebootBtn', 'stopVmBtn', 'requestVmBtn'].forEach((id) => show(id, false));
    return;
  }

  // assigned
  statusEl.innerHTML =
    `<i class="fa-solid fa-circle-check text-emerald-400 mr-2"></i>Läuft - IP ${esc(vm.ip)}, zugewiesen ${esc(relTime(vm.assignedAt))}`;
  currentReapAt = vm.reapAt || null;
  updateIdleCountdown();

  const connect = el('connectBtn');
  if (vm.connectUrl) {
    connect.href = vm.connectUrl;
    connect.hidden = false;
  } else {
    connect.hidden = true;
  }
  show('extendBtn', true);
  show('rebootBtn', true);
  show('stopVmBtn', true);
  show('requestVmBtn', false);
}

function updateIdleCountdown() {
  const idleEl = el('idleInfo');
  if (!currentReapAt) { idleEl.hidden = true; return; }
  const when = new Date(currentReapAt);
  idleEl.hidden = false;
  idleEl.textContent = `Automatischer Abbau bei Leerlauf um ${when.toLocaleTimeString('de-DE')} (${relTime(currentReapAt)})`;
}
setInterval(updateIdleCountdown, 1000);

async function refreshMyVmOnce() {
  try {
    renderMyVm(await fetchJson('/api/my-vm'));
  } catch (err) {
    if (err.status === 401) { window.location.href = '/auth/login'; return; }
    el('myVmStatus').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  }
}

function busy(btn, on, labelHtml) {
  btn.disabled = on;
  if (on) { btn.dataset.html = btn.innerHTML; btn.innerHTML = labelHtml || btn.innerHTML; }
  else if (btn.dataset.html) { btn.innerHTML = btn.dataset.html; delete btn.dataset.html; }
}

el('requestVmBtn').addEventListener('click', async () => {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch (_) {}
  const btn = el('requestVmBtn');
  busy(btn, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Fordere VM an...');
  el('myVmStatus').innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Fordere VM an - das kann einige Minuten dauern...';
  const tplSel = el('templateSelect');
  const body = tplSel && !el('templatePick').hidden && tplSel.value ? { template: tplSel.value } : {};
  try {
    await fetchJson('/api/my-vm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await refreshMyVmOnce();
  } catch (err) {
    el('myVmStatus').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  } finally {
    busy(btn, false);
  }
});

async function loadTemplates() {
  try {
    const { templates, quota } = await fetchJson('/api/templates');
    const opts = templates.map((t) =>
      `<option value="${esc(t.name)}"${t.default ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
    for (const id of ['templateSelect', 'adminProvisionTemplate', 'scheduleTemplate']) {
      const sel = el(id);
      if (sel) sel.innerHTML = opts;
    }
    const multi = templates.length > 1;
    el('templatePick').hidden = !multi;
    el('adminProvisionTemplate').hidden = !multi;
    if (quota) {
      el('quotaHint').hidden = false;
      el('quotaHint').textContent = `Kontingent: ${quota} gleichzeitige VM${quota === 1 ? '' : 's'}`;
    }
  } catch (_) { /* Templates optional */ }
}

el('stopVmBtn').addEventListener('click', async () => {
  if (!confirm('Sitzung wirklich beenden? Die VM wird abgebaut.')) return;
  const btn = el('stopVmBtn');
  busy(btn, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Beende...');
  try {
    await fetchJson('/api/my-vm', { method: 'DELETE' });
    await refreshMyVmOnce();
  } catch (err) {
    el('myVmStatus').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  } finally {
    busy(btn, false);
  }
});

el('extendBtn').addEventListener('click', async () => {
  const btn = el('extendBtn');
  busy(btn, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i>...');
  try {
    const vm = await fetchJson('/api/my-vm/keepalive', { method: 'POST' });
    renderMyVm(vm);
  } catch (err) {
    el('myVmStatus').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  } finally {
    busy(btn, false);
  }
});

el('rebootBtn').addEventListener('click', async () => {
  if (!confirm('VM neu starten? Laufende Programme in der Sitzung werden beendet.')) return;
  const btn = el('rebootBtn');
  busy(btn, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Startet neu...');
  try {
    await fetchJson('/api/my-vm/reboot', { method: 'POST' });
    el('myVmStatus').innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400 mr-2"></i>Neustart ausgelöst.';
  } catch (err) {
    el('myVmStatus').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  } finally {
    busy(btn, false);
  }
});

async function loadHistory() {
  try {
    const rows = await fetchJson('/api/my-history');
    const ul = el('historyList');
    ul.innerHTML = rows.length
      ? rows.map((h) =>
          `<li>${esc(formatDate(h.assignedAt))} - ${esc(h.durationMinutes)} Min. (beendet: ${esc(h.endedBy || 'system')})</li>`
        ).join('')
      : '<li class="text-slate-500">Noch keine Sitzungen.</li>';
  } catch (_) { /* Historie ist optional */ }
}

// ---- Geplante Anforderungen (Selbstbedienung) ----------------------

async function loadMySchedules() {
  try {
    const rows = await fetchJson('/api/my-schedules');
    const ul = el('scheduleList');
    ul.innerHTML = rows.length
      ? rows.map((s) => `
          <li class="flex items-center gap-2">
            <span>${esc(formatDate(s.notBefore))} · ${esc(s.template)} · <span class="${s.status === 'pending' ? 'text-amber-400' : s.status === 'done' ? 'text-emerald-400' : 'text-slate-500'}">${esc(s.status)}</span></span>
            ${s.status === 'pending' ? `<button data-cancel-schedule="${esc(s.id)}" class="text-rose-400 hover:text-rose-300">stornieren</button>` : ''}
          </li>`).join('')
      : '<li class="text-slate-500">Keine Planungen.</li>';
    ul.querySelectorAll('[data-cancel-schedule]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetchJson(`/api/my-schedules/${encodeURIComponent(btn.dataset.cancelSchedule)}`, { method: 'DELETE' });
          loadMySchedules();
        } catch (err) { alert(err.message); btn.disabled = false; }
      });
    });
  } catch (_) { /* optional */ }
}

el('scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const when = el('scheduleWhen').value;
  if (!when) return;
  try {
    await fetchJson('/api/my-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notBefore: new Date(when).toISOString(), template: el('scheduleTemplate').value || undefined }),
    });
    el('scheduleWhen').value = '';
    loadMySchedules();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Ankündigungsbanner --------------------------------------

function renderAnnouncement(a) {
  const bar = el('announcementBar');
  if (!a || !a.text) { bar.hidden = true; return; }
  const palette = {
    info: 'bg-slate-800 border-slate-700 text-slate-200',
    warning: 'bg-amber-950 border-amber-800 text-amber-200',
    critical: 'bg-rose-950 border-rose-800 text-rose-200',
  };
  bar.className = `rounded-lg px-4 py-3 text-sm flex items-start gap-2 border ${palette[a.level] || palette.info}`;
  el('announcementText').textContent = a.text;
  bar.hidden = false;
}

// ---- Admin: System-Status ---------------------------------

function renderStatus(status) {
  const ul = el('statusList');
  if (!status || !status.checks) { ul.innerHTML = '<li class="text-slate-500">Kein Status verfügbar.</li>'; return; }
  const line = (label, ok, extra) =>
    `<li class="flex items-center gap-2">
       <i class="fa-solid fa-circle text-[9px] ${ok ? 'text-emerald-400' : 'text-rose-400'}"></i>
       <span>${esc(label)}</span>
       <span class="text-slate-500 text-xs">${esc(extra || '')}</span>
     </li>`;
  const c = status.checks;
  ul.innerHTML = [
    line('Provisioning-Service', status.ok !== undefined),
    line('Proxmox', c.proxmox && c.proxmox.ok, c.proxmox && c.proxmox.error),
    line('Kasm', c.kasm && c.kasm.ok, c.kasm && c.kasm.error),
    line('VM-Pool', true, c.pool ? `${c.pool.current}/${c.pool.target}` : ''),
  ].join('');
}

// ---- Admin: Kapazität ----------------------------------

function bar(used, total) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return `<div class="capbar"><span style="width:${pct}%"></span></div>`;
}
function gib(bytes) {
  return bytes ? `${(bytes / 1073741824).toFixed(1)} GB` : '?';
}

function renderCapacity(cap) {
  const box = el('capacityBox');
  if (!cap) { box.textContent = 'Nicht verfügbar.'; return; }
  const counts = cap.counts || {};
  const parts = [
    `<div>Zugewiesen: <span class="text-slate-200">${esc(counts.assigned ?? 0)}</span>
       &nbsp;·&nbsp; Pool: <span class="text-slate-200">${esc(counts.pool ?? 0)}</span>
       &nbsp;·&nbsp; in Arbeit: <span class="text-slate-200">${esc((counts.claiming ?? 0) + (counts.deprovisioning ?? 0))}</span></div>`,
  ];
  if (cap.node) {
    const n = cap.node;
    if (n.cpu != null) parts.push(`<div>CPU-Last: ${Math.round(n.cpu * 100)}% ${bar(n.cpu, 1)}</div>`);
    if (n.memTotal) parts.push(`<div>RAM: ${gib(n.memUsed)} / ${gib(n.memTotal)} ${bar(n.memUsed, n.memTotal)}</div>`);
    if (n.storageTotal) parts.push(`<div>Storage: ${gib(n.storageUsed)} / ${gib(n.storageTotal)} ${bar(n.storageUsed, n.storageTotal)}</div>`);
  } else {
    parts.push(`<div class="text-amber-400 text-xs"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Node-Auslastung nicht abrufbar${cap.nodeError ? ': ' + esc(cap.nodeError) : ''}</div>`);
  }
  box.innerHTML = parts.join('');
}

// ---- Admin: Pool-Steuerung -----------------------------

async function loadPool() {
  try {
    const p = await fetchJson('/api/pool');
    el('poolInfo').innerHTML =
      `Ziel <span class="text-slate-200">${esc(p.target)}</span> · aktuell im Pool <span class="text-slate-200">${esc(p.current)}</span>` +
      (p.override != null ? ` <span class="text-xs text-amber-400">(Override aktiv, .env: ${esc(p.configured)})</span>` : '');
    if (!el('poolSize').value) el('poolSize').value = p.target;
  } catch (err) {
    el('poolInfo').textContent = err.message;
  }
}

el('poolForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('poolStatus').textContent = '';
  try {
    await fetchJson('/api/pool', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: Number(el('poolSize').value) }),
    });
    el('poolStatus').textContent = 'Übernommen.';
    loadPool();
  } catch (err) {
    el('poolStatus').textContent = err.message;
  }
});

// ---- Admin: Ankündigung setzen -------------------------

async function loadAnnounceEditor() {
  try {
    const a = await fetchJson('/api/announcement');
    el('announceText').value = a.text || '';
    el('announceLevel').value = a.level || 'info';
  } catch (_) {}
}

el('announceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('announceStatus').textContent = '';
  try {
    const a = await fetchJson('/api/announcement', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: el('announceText').value, level: el('announceLevel').value }),
    });
    renderAnnouncement(a);
    el('announceStatus').textContent = a.text ? 'Gespeichert.' : 'Banner ausgeblendet.';
  } catch (err) {
    el('announceStatus').textContent = err.message;
  }
});

// ---- Admin: Audit-Log ---------------------------------

let auditBefore = null;

async function loadAudit(reset) {
  if (reset) { auditBefore = null; el('auditTableBody').innerHTML = rowLoading(5); }
  try {
    const data = await fetchJson('/api/audit?' + new URLSearchParams(auditBefore ? { before: auditBefore } : {}));
    const rows = data.entries.map((a) => `
      <tr>
        <td class="py-2 whitespace-nowrap">${esc(formatDate(a.ts))}</td>
        <td class="py-2">${esc(a.action)}</td>
        <td class="py-2">${esc(a.actor)}</td>
        <td class="py-2 text-slate-400">${esc([a.vmid, a.username].filter(Boolean).join(' / '))}</td>
        <td class="py-2 text-slate-400">${esc(a.detail || '')}</td>
      </tr>`).join('');
    if (reset) el('auditTableBody').innerHTML = rows || rowEmpty(5, 'Noch keine Einträge.');
    else el('auditTableBody').insertAdjacentHTML('beforeend', rows);
    auditBefore = data.nextBefore;
    el('auditMore').hidden = !data.nextBefore;
  } catch (err) {
    if (reset) el('auditTableBody').innerHTML = rowError(5, err.message);
  }
}
el('auditMore').addEventListener('click', () => loadAudit(false));

// ---- Admin: API-Tokens ------------------------------------

async function loadTokens() {
  const tbody = el('tokensTableBody');
  tbody.innerHTML = rowLoading(6);
  try {
    const tokens = await fetchJson('/api/tokens');
    tbody.innerHTML = tokens.length
      ? tokens.map((t) => `
          <tr>
            <td class="py-2">${esc(t.name)}</td>
            <td class="py-2 text-slate-400">${esc(t.username)}</td>
            <td class="py-2 font-mono text-xs text-slate-400">${esc(t.tokenPrefix)}…</td>
            <td class="py-2 text-slate-400 whitespace-nowrap">${esc(formatDate(t.createdAt))}</td>
            <td class="py-2 text-slate-400 whitespace-nowrap">${t.lastUsedAt ? esc(formatDate(t.lastUsedAt)) : '-'}</td>
            <td class="py-2 text-right">
              <button data-del-token="${esc(t.id)}" class="text-rose-400 hover:text-rose-300 text-xs inline-flex items-center gap-1">
                <i class="fa-solid fa-trash"></i> Widerrufen
              </button>
            </td>
          </tr>`).join('')
      : rowEmpty(6, 'Keine Tokens.');
    tbody.querySelectorAll('[data-del-token]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Token widerrufen? Automatisierungen damit brechen sofort.')) return;
        btn.disabled = true;
        try {
          await fetchJson(`/api/tokens/${encodeURIComponent(btn.dataset.delToken)}`, { method: 'DELETE' });
          loadTokens();
        } catch (err) { alert(err.message); btn.disabled = false; }
      });
    });
  } catch (err) {
    tbody.innerHTML = rowError(6, err.message);
  }
}

el('tokenForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('tokenName').value.trim();
  if (!name) return;
  try {
    const created = await fetchJson('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username: el('tokenUser').value.trim() || undefined }),
    });
    el('tokenRevealValue').textContent = created.token;
    el('tokenReveal').hidden = false;
    el('tokenName').value = '';
    el('tokenUser').value = '';
    loadTokens();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Admin: Nutzung / Kosten ----------------------------

async function loadUsage() {
  const box = el('usageBox');
  box.innerHTML = rowLoading ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Lädt...' : 'Lädt...';
  try {
    const u = await fetchJson('/api/usage');
    const users = Object.entries(u.byUser).sort((a, b) => b[1].minutes - a[1].minutes);
    const cost = (v) => (u.costPerHour ? ` · ${v.cost.toFixed(2)} ${esc(u.currency)}` : '');
    box.innerHTML = `
      <div class="mb-2 text-slate-300">Gesamt: ${u.total.sessions} Sitzungen · ${Math.round(u.total.minutes / 60)} Std.${u.costPerHour ? ` · ${u.total.cost.toFixed(2)} ${esc(u.currency)}` : ''}</div>
      <table class="w-full">
        <thead><tr class="text-slate-500 text-left"><th class="py-1 font-medium">Nutzer</th><th class="py-1 font-medium">Sitzungen</th><th class="py-1 font-medium">Stunden</th></tr></thead>
        <tbody>${users.length ? users.map(([name, v]) =>
          `<tr><td class="py-1">${esc(name)}</td><td class="py-1">${v.sessions}</td><td class="py-1">${(v.minutes / 60).toFixed(1)}${cost(v)}</td></tr>`
        ).join('') : '<tr><td colspan="3" class="py-1 text-slate-500">Noch keine abgeschlossenen Sitzungen.</td></tr>'}</tbody>
      </table>`;
  } catch (err) {
    box.textContent = err.message;
  }
}

// ---- Admin: verwaiste Ressourcen -----------------------

async function loadOrphans() {
  const box = el('orphansBox');
  box.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Prüfe...';
  try {
    const o = await fetchJson('/api/orphans');
    const list = (arr, fmt) => arr.length ? '<ul class="list-disc ml-4">' + arr.map((x) => `<li>${fmt(x)}</li>`).join('') + '</ul>' : '<span class="text-slate-500">keine</span>';
    box.innerHTML = `
      <div class="mb-2">Proxmox-VMs ohne Eintrag: ${list(o.proxmox, (v) => `${esc(v.vmid)} (${esc(v.name)}, ${esc(v.status)})`)}</div>
      <div>Kasm-Server ohne VM: ${list(o.kasm, (s) => `${esc(s.name || s.server_id)}`)}</div>
      ${o.errors && (o.errors.proxmox || o.errors.kasm) ? `<div class="text-amber-400 text-xs mt-2">Teilprüfung fehlgeschlagen: ${esc(o.errors.proxmox || '')} ${esc(o.errors.kasm || '')}</div>` : ''}`;
  } catch (err) {
    box.textContent = err.message;
  }
}

// ---- Admin: Nutzer-Detail -----------------------------

async function loadUserDetail(uid) {
  const box = el('userDetail');
  box.hidden = false;
  box.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Lädt...';
  try {
    const d = await fetchJson(`/api/users/${encodeURIComponent(uid)}`);
    const vm = d.vm
      ? `VM ${esc(d.vm.vmid)} (${esc(d.vm.status)}, IP ${esc(d.vm.ip || '-')}, Typ ${esc(d.vm.template || 'standard')})`
      : 'keine aktive VM';
    const hist = (d.history || []).slice(0, 5)
      .map((h) => `<li>${esc(formatDate(h.assignedAt))} · ${esc(h.durationMinutes)} Min.</li>`).join('') || '<li class="text-slate-500">keine</li>';
    box.innerHTML = `
      <div class="flex items-center justify-between">
        <strong class="text-slate-200">${esc(d.user.name || d.user.uid)}</strong>
        <button id="userDetailClose" class="text-slate-500 hover:text-slate-300 text-xs">schließen</button>
      </div>
      <div>${esc(d.user.uid)} · ${esc(d.user.email || '')}</div>
      <div class="mt-1">Aktuell: ${vm}</div>
      <div class="mt-1">Letzte Sitzungen:</div>
      <ul class="list-disc ml-4 text-xs">${hist}</ul>`;
    el('userDetailClose').addEventListener('click', () => { box.hidden = true; });
  } catch (err) {
    box.innerHTML = `<span class="text-rose-400">${esc(err.message)}</span>`;
  }
}

el('bulkIdleBtn').addEventListener('click', async () => {
  if (!confirm('Alle VMs ohne aktive Kasm-Sitzung jetzt abbauen?')) return;
  const btn = el('bulkIdleBtn');
  btn.disabled = true;
  try {
    const r = await fetchJson('/api/vms/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deprovision-idle' }),
    });
    setVmsStatus(`${r.count} VM(s) abgebaut.`);
    loadVms();
  } catch (err) {
    setVmsStatus(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---- Admin: Tabellen (Nutzer / Sitzungen / VMs) -----

const tables = {
  users: { rows: [], filter: '', sort: null, dir: 1, cols: 3 },
  sessions: { rows: [], filter: '', sort: null, dir: 1, cols: 4 },
  vms: { rows: [], filter: '', sort: null, dir: 1, cols: 6 },
};

function renderTable(name) {
  const t = tables[name];
  const tbody = el(`${name}TableBody`);
  let rows = t.rows.slice();

  if (t.filter) {
    const q = t.filter.toLowerCase();
    rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }
  if (t.sort) {
    rows.sort((a, b) => {
      const av = a[t.sort] ?? '';
      const bv = b[t.sort] ?? '';
      return (av > bv ? 1 : av < bv ? -1 : 0) * t.dir;
    });
  }
  if (!rows.length) { tbody.innerHTML = rowEmpty(t.cols, 'Keine Einträge.'); return; }

  if (name === 'users') {
    tbody.innerHTML = rows.map((u) => `
      <tr>
        <td class="py-2"><button data-user-detail="${esc(u.uid)}" class="text-indigo-400 hover:text-indigo-300">${esc(u.uid)}</button></td>
        <td class="py-2">${esc(u.name)}</td>
        <td class="py-2 text-slate-400">${esc(u.email)}</td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-user-detail]').forEach((btn) => {
      btn.addEventListener('click', () => loadUserDetail(btn.dataset.userDetail));
    });
  } else if (name === 'sessions') {
    tbody.innerHTML = rows.map((s) => `
      <tr>
        <td class="py-2">${esc(s.kasm_id)}</td>
        <td class="py-2">${esc(s.user)}</td>
        <td class="py-2 text-slate-400">${esc(s.status)}</td>
        <td class="py-2 text-right">
          ${s.kasm_id ? `<button data-disconnect="${esc(s.kasm_id)}" class="text-amber-400 hover:text-amber-300 text-xs inline-flex items-center gap-1"><i class="fa-solid fa-plug-circle-xmark"></i> Trennen</button>` : ''}
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-disconnect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Sitzung trennen? Die VM bleibt bestehen, der Nutzer kann sich neu verbinden.')) return;
        btn.disabled = true;
        try {
          await fetchJson(`/api/sessions/${encodeURIComponent(btn.dataset.disconnect)}/disconnect`, { method: 'POST' });
          loadSessions();
        } catch (err) { alert(err.message); btn.disabled = false; }
      });
    });
  } else {
    tbody.innerHTML = rows.map((vm) => `
      <tr>
        <td class="py-2">${esc(vm.vmid)}</td>
        <td class="py-2">${esc(vm.username)}</td>
        <td class="py-2 text-slate-400">${esc(vm.ip)}</td>
        <td class="py-2 text-slate-400 whitespace-nowrap">${esc(formatDate(vm.assignedAt))}</td>
        <td class="py-2 text-slate-400 whitespace-nowrap">${vm.reapAt ? esc(relTime(vm.reapAt)) : '-'}</td>
        <td class="py-2 text-right">
          <button data-stop-vmid="${esc(vm.vmid)}" class="text-rose-400 hover:text-rose-300 text-xs inline-flex items-center gap-1">
            <i class="fa-solid fa-power-off"></i> Stoppen
          </button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-stop-vmid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`VM ${btn.dataset.stopVmid} abbauen?`)) return;
        btn.disabled = true;
        setVmsStatus('');
        try {
          await fetchJson(`/api/vms/${encodeURIComponent(btn.dataset.stopVmid)}`, { method: 'DELETE' });
          loadVms();
        } catch (err) {
          setVmsStatus(`Stoppen fehlgeschlagen: ${err.message}`);
          btn.disabled = false;
        }
      });
    });
  }
}

function setVmsStatus(message) {
  const s = el('vmsStatus');
  if (!message) { s.hidden = true; s.textContent = ''; }
  else { s.hidden = false; s.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i>${esc(message)}`; }
}

async function loadUsers() {
  el('usersTableBody').innerHTML = rowLoading(3);
  try {
    const users = await fetchJson('/api/users');
    tables.users.rows = users.map((u) => ({ uid: u.uid || '', name: u.name || '', email: u.email || '' }));
    renderTable('users');
  } catch (err) { el('usersTableBody').innerHTML = rowError(3, err.message); }
}

async function loadSessions() {
  el('sessionsTableBody').innerHTML = rowLoading(3);
  try {
    const sessions = await fetchJson('/api/sessions');
    tables.sessions.rows = sessions.map((s) => ({
      kasm_id: s.kasm_id || '',
      user: s.user_id || s.username || '',
      status: s.operational_status || s.status || '',
    }));
    renderTable('sessions');
  } catch (err) { el('sessionsTableBody').innerHTML = rowError(3, err.message); }
}

function setVmsRows(vms) {
  tables.vms.rows = (vms || []).map((vm) => ({
    vmid: vm.vmid,
    username: vm.username || '',
    ip: vm.ip || '',
    assignedAt: vm.assignedAt || '',
    reapAt: vm.reapAt || '',
  }));
  renderTable('vms');
}

async function loadVms() {
  el('vmsTableBody').innerHTML = rowLoading(6);
  try {
    setVmsRows(await fetchJson('/api/vms'));
  } catch (err) { el('vmsTableBody').innerHTML = rowError(6, err.message); }
}

// Filter- und Sortier-Bedienung (Event-Delegation)
document.querySelectorAll('[data-filter]').forEach((input) => {
  input.addEventListener('input', () => {
    const name = input.dataset.filter;
    tables[name].filter = input.value;
    renderTable(name);
  });
});
document.querySelectorAll('table[data-table] th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const name = th.closest('table').dataset.table;
    const key = th.dataset.sort;
    const t = tables[name];
    if (t.sort === key) t.dir *= -1;
    else { t.sort = key; t.dir = 1; }
    th.closest('tr').querySelectorAll('th[data-sort]').forEach((o) => o.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', t.dir === 1 ? 'ascending' : 'descending');
    renderTable(name);
  });
});

document.querySelectorAll('[data-refresh]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.refresh;
    ({
      users: loadUsers,
      sessions: loadSessions,
      vms: loadVms,
      audit: () => loadAudit(true),
      usage: loadUsage,
      orphans: loadOrphans,
    }[target] || (() => {}))();
  });
});

el('adminProvisionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = el('adminProvisionUsername');
  const statusEl = el('adminProvisionStatus');
  const username = input.value.trim();
  if (!username) return;
  statusEl.className = 'text-sm text-slate-400 mt-3';
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Fordere VM an...';
  const tpl = el('adminProvisionTemplate');
  const payload = { username };
  if (tpl && !tpl.hidden && tpl.value) payload.template = tpl.value;
  try {
    const data = await fetchJson('/api/vms/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    statusEl.className = 'text-sm text-emerald-400 mt-3';
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check mr-2"></i>VM ${esc(data.vmid)} (${esc(data.ip)}) für '${esc(username)}' bereit.`;
    input.value = '';
    loadVms();
  } catch (err) {
    statusEl.className = 'text-sm text-rose-400 mt-3';
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i>${esc(err.message)}`;
  }
});

// ---- Live-Updates (SSE) mit Polling-Fallback ---------------

let eventSource = null;
let pollTimer = null;

function applyState(payload) {
  renderMyVm(payload.myVm);
  renderAnnouncement(payload.announcement);
  if (currentUser && currentUser.isAdmin && payload.admin) {
    if (payload.admin.status) renderStatus(payload.admin.status);
    if (payload.admin.capacity) renderCapacity(payload.admin.capacity);
    if (Array.isArray(payload.admin.vms)) setVmsRows(payload.admin.vms);
  }
}

function startEventStream() {
  try {
    eventSource = new EventSource('/api/events');
  } catch (_) {
    return startPolling();
  }
  eventSource.addEventListener('open', () => {
    el('liveDot').classList.remove('hidden');
    el('liveDot').classList.add('flex');
    el('liveDot').querySelector('i').className = 'fa-solid fa-circle text-[8px] text-emerald-400';
    stopPolling();
  });
  eventSource.addEventListener('state', (e) => {
    try { applyState(JSON.parse(e.data)); } catch (_) {}
  });
  eventSource.onerror = () => {
    el('liveDot').querySelector('i').className = 'fa-solid fa-circle text-[8px] text-amber-400';
    if (eventSource) { eventSource.close(); eventSource = null; }
    startPolling();
    setTimeout(() => { if (!eventSource) startEventStream(); }, 20000);
  };
}

function startPolling() {
  if (pollTimer) return;
  const tick = async () => {
    if (!document.hidden) {
      await refreshMyVmOnce();
      try { renderAnnouncement(await fetchJson('/api/announcement')); } catch (_) {}
      if (currentUser && currentUser.isAdmin) {
        try { renderStatus(await fetchJson('/api/status')); } catch (_) {}
        try { renderCapacity(await fetchJson('/api/capacity')); } catch (_) {}
        try { setVmsRows(await fetchJson('/api/vms')); } catch (_) {}
      }
    }
    pollTimer = setTimeout(tick, 15000);
  };
  pollTimer = setTimeout(tick, 15000);
}
function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

// ---- Einstiegspunkt ---------------------------------------

function showAppError(message) {
  el('appErrorText').textContent = message;
  el('appError').hidden = false;
}

async function init() {
  try {
    currentUser = await fetchJson('/api/me');
  } catch (err) {
    el('appLoading').hidden = true;
    if (err.status === 401) { window.location.href = '/auth/login'; return; }
    showAppError(`Dashboard konnte nicht geladen werden: ${err.message}`);
    return;
  }

  el('appLoading').hidden = true;
  el('selfService').hidden = false;
  el('whoami').innerHTML =
    `<i class="fa-solid fa-user"></i> ${esc(currentUser.username || currentUser.email || '')}` +
    (currentUser.isAdmin ? ' <span class="text-indigo-400">(Admin)</span>' : '');

  await refreshMyVmOnce();
  loadHistory();
  loadTemplates();
  loadMySchedules();

  if (currentUser.isAdmin) {
    el('adminSections').hidden = false;
    loadUsers();
    loadSessions();
    loadVms();
    loadPool();
    loadAnnounceEditor();
    loadAudit(true);
    loadTokens();
    loadUsage();
  }

  startEventStream();
}

init();
