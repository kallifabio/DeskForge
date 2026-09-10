const POLL_INTERVAL_MS = 15000;

// HTML-Escaping fuer alle Werte, die aus LDAP / Kasm / Proxmox stammen
// und per innerHTML in die Seite geschrieben werden (Schutz vor XSS).
function esc(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch (_) { /* leerer Body, z.B. bei 204 */ }
  if (!res.ok) {
    const err = new Error(data.error || `Fehler bei ${url}`);
    err.status = res.status;
    throw err;
  }
  return data;
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
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE');
}

// ---- Polling: rekursives setTimeout, pausiert im Hintergrund-Tab ------

const pollers = [];
function registerPoll(fn) {
  pollers.push(fn);
  const schedule = () => setTimeout(run, POLL_INTERVAL_MS);
  async function run() {
    if (!document.hidden) {
      try { await fn(); } catch (_) { /* Fehler zeigt fn selbst an */ }
    }
    schedule();
  }
  schedule();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollers.forEach((fn) => Promise.resolve(fn()).catch(() => {}));
});

// ---- Selbstbedienung ------------------------------------------------

async function refreshMyVm() {
  const statusEl = document.getElementById('myVmStatus');
  const requestBtn = document.getElementById('requestVmBtn');
  const stopBtn = document.getElementById('stopVmBtn');
  try {
    const vm = await fetchJson('/api/my-vm');
    if (!vm) {
      statusEl.innerHTML = '<i class="fa-solid fa-circle-info mr-2"></i>Aktuell keine VM zugewiesen.';
      requestBtn.hidden = false;
      stopBtn.hidden = true;
    } else {
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400 mr-2"></i>Läuft - IP ${esc(vm.ip)}, zugewiesen seit ${esc(formatDate(vm.assignedAt))}`;
      requestBtn.hidden = true;
      stopBtn.hidden = false;
    }
  } catch (err) {
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  }
}

document.getElementById('requestVmBtn').addEventListener('click', async () => {
  const btn = document.getElementById('requestVmBtn');
  const statusEl = document.getElementById('myVmStatus');
  btn.disabled = true;
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Fordere VM an - das kann einige Minuten dauern...';
  try {
    await fetchJson('/api/my-vm', { method: 'POST' });
    await refreshMyVm();
  } catch (err) {
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('stopVmBtn').addEventListener('click', async () => {
  const btn = document.getElementById('stopVmBtn');
  const statusEl = document.getElementById('myVmStatus');
  btn.disabled = true;
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Sitzung wird beendet...';
  try {
    await fetchJson('/api/my-vm', { method: 'DELETE' });
    await refreshMyVm();
  } catch (err) {
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400 mr-2"></i>${esc(err.message)}`;
  } finally {
    btn.disabled = false;
  }
});

// ---- Admin: Nutzer (LDAP) --------------------------------------------

async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = rowLoading(3);
  try {
    const users = await fetchJson('/api/users');
    tbody.innerHTML = users.length
      ? users.map((u) => `
          <tr>
            <td class="py-2">${esc(u.uid)}</td>
            <td class="py-2">${esc(u.name)}</td>
            <td class="py-2 text-slate-400">${esc(u.email)}</td>
          </tr>
        `).join('')
      : rowEmpty(3, 'Keine Nutzer gefunden.');
  } catch (err) {
    tbody.innerHTML = rowError(3, err.message);
  }
}

// ---- Admin: Sitzungen (Kasm) -------------------------------------------

async function loadSessions() {
  const tbody = document.getElementById('sessionsTableBody');
  tbody.innerHTML = rowLoading(3);
  try {
    const sessions = await fetchJson('/api/sessions');
    tbody.innerHTML = sessions.length
      ? sessions.map((s) => `
          <tr>
            <td class="py-2">${esc(s.kasm_id)}</td>
            <td class="py-2">${esc(s.user_id || s.username)}</td>
            <td class="py-2 text-slate-400">${esc(s.operational_status || s.status)}</td>
          </tr>
        `).join('')
      : rowEmpty(3, 'Keine aktiven Sitzungen.');
  } catch (err) {
    tbody.innerHTML = rowError(3, err.message);
  }
}

// ---- Admin: VMs ---------------------------------------------------------

function setVmsStatus(message) {
  const el = document.getElementById('vmsStatus');
  if (!message) {
    el.hidden = true;
    el.textContent = '';
  } else {
    el.hidden = false;
    el.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i>${esc(message)}`;
  }
}

async function loadVms() {
  const tbody = document.getElementById('vmsTableBody');
  tbody.innerHTML = rowLoading(5);
  try {
    const vms = await fetchJson('/api/vms');
    tbody.innerHTML = vms.length
      ? vms.map((vm) => `
          <tr>
            <td class="py-2">${esc(vm.vmid)}</td>
            <td class="py-2">${esc(vm.username)}</td>
            <td class="py-2 text-slate-400">${esc(vm.ip)}</td>
            <td class="py-2 text-slate-400">${esc(formatDate(vm.assignedAt))}</td>
            <td class="py-2 text-right">
              <button data-stop-vmid="${esc(vm.vmid)}" class="text-rose-400 hover:text-rose-300 text-xs inline-flex items-center gap-1">
                <i class="fa-solid fa-power-off"></i> Stoppen
              </button>
            </td>
          </tr>
        `).join('')
      : rowEmpty(5, 'Keine zugewiesenen VMs.');

    tbody.querySelectorAll('[data-stop-vmid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        setVmsStatus('');
        try {
          await fetchJson(`/api/vms/${encodeURIComponent(btn.dataset.stopVmid)}`, { method: 'DELETE' });
          await loadVms();
        } catch (err) {
          setVmsStatus(`Stoppen fehlgeschlagen: ${err.message}`);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = rowError(5, err.message);
  }
}

document.querySelectorAll('[data-refresh]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.refresh;
    if (target === 'users') loadUsers();
    if (target === 'sessions') loadSessions();
    if (target === 'vms') loadVms();
  });
});

document.getElementById('adminProvisionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('adminProvisionUsername');
  const statusEl = document.getElementById('adminProvisionStatus');
  const username = input.value.trim();
  if (!username) return;

  statusEl.className = 'text-sm text-slate-400 mt-3';
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Fordere VM an...';
  try {
    const data = await fetchJson('/api/vms/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
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

// ---- Einstiegspunkt: Rolle bestimmen und passende Ansicht laden --------

function showAppError(message) {
  document.getElementById('appErrorText').textContent = message;
  document.getElementById('appError').hidden = false;
}

async function init() {
  const loadingEl = document.getElementById('appLoading');
  let me;
  try {
    me = await fetchJson('/api/me');
  } catch (err) {
    loadingEl.hidden = true;
    if (err.status === 401) {
      // Nicht angemeldet: Server leitet bei einer normalen Navigation
      // ohnehin auf /auth/login um.
      window.location.href = '/auth/login';
      return;
    }
    showAppError(`Dashboard konnte nicht geladen werden: ${err.message}`);
    return;
  }

  loadingEl.hidden = true;
  document.getElementById('selfService').hidden = false;

  document.getElementById('whoami').innerHTML =
    `<i class="fa-solid fa-user"></i> ${esc(me.username || me.email || '')}` +
    (me.isAdmin ? ' <span class="text-indigo-400">(Admin)</span>' : '');

  refreshMyVm();
  registerPoll(refreshMyVm);

  if (me.isAdmin) {
    document.getElementById('adminSections').hidden = false;
    loadUsers();
    loadSessions();
    loadVms();
    registerPoll(loadSessions);
    registerPoll(loadVms);
  }
}

init();
