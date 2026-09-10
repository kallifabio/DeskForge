// shared/proxmoxClient.js
//
// Wrapper um die Proxmox-VE-REST-API. Nimmt bewusst eine bereits fertig
// konfigurierte Axios-Instanz entgegen (Basis-URL, Auth-Header, ggf.
// CA-Zertifikat), statt sie selbst zu bauen - so kommt dieses Modul ohne
// eigene node_modules aus und lässt sich per relativem Pfad aus mehreren
// Services heraus wiederverwenden, ohne dass Node beim Auflösen von
// require('axios') danebengreift (Node sucht node_modules relativ zum
// Pfad der Datei, die require() aufruft - ein "shared"-Ordner ohne
// eigene Abhängigkeiten umgeht dieses Problem komplett).

class ProxmoxClient {
  constructor(axiosInstance, { node }) {
    this.client = axiosInstance;
    this.node = node;
  }

  async getNextVmid() {
    const res = await this.client.get('/cluster/nextid');
    return parseInt(res.data.data, 10);
  }

  // Stößt das Klonen nur AN und gibt sofort die Task-ID (UPID) zurück,
  // ohne auf den Abschluss zu warten. Wichtig für die Mutex-Nutzung: die
  // VMID-Vergabe + das Absenden des Klon-Auftrags müssen unter Lock
  // passieren, das mehrminütige Warten auf den Abschluss aber NICHT -
  // sonst würde der Mutex alle anderen Anfragen blockieren, während eine
  // VM klont.
  async submitClone({ templateVmid, newVmid, name, linked = false }) {
    const res = await this.client.post(`/nodes/${this.node}/qemu/${templateVmid}/clone`, {
      newid: newVmid,
      name,
      // full:0 = Linked Clone (schnell, spart Platz, braucht Storage mit
      // Snapshot-Unterstützung wie LVM-thin/ZFS/Ceph oder qcow2 auf
      // Directory-Storage). full:1 = vollständige, unabhängige Kopie.
      full: linked ? 0 : 1,
    });
    return res.data.data; // UPID
  }

  async cloneVm({ templateVmid, newVmid, name, linked = false }) {
    const upid = await this.submitClone({ templateVmid, newVmid, name, linked });
    await this.waitForTask(upid);
    return newVmid;
  }

  async waitForTask(upid, { timeoutMs = 5 * 60 * 1000, intervalMs = 2000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await this.client.get(`/nodes/${this.node}/tasks/${encodeURIComponent(upid)}/status`);
      const status = res.data.data;
      if (status.status === 'stopped') {
        if (status.exitstatus !== 'OK') {
          throw new Error(`Proxmox-Task ${upid} ist fehlgeschlagen: ${status.exitstatus}`);
        }
        return status;
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timeout beim Warten auf Proxmox-Task ${upid}`);
  }

  async startVm(vmid) {
    const res = await this.client.post(`/nodes/${this.node}/qemu/${vmid}/status/start`);
    await this.waitForTask(res.data.data);
  }

  async stopVm(vmid) {
    const res = await this.client.post(`/nodes/${this.node}/qemu/${vmid}/status/stop`);
    await this.waitForTask(res.data.data);
  }

  async deleteVm(vmid) {
    const res = await this.client.delete(`/nodes/${this.node}/qemu/${vmid}`);
    await this.waitForTask(res.data.data);
  }

  async getVmStatus(vmid) {
    const res = await this.client.get(`/nodes/${this.node}/qemu/${vmid}/status/current`);
    return res.data.data;
  }

  // Alle QEMU-VMs auf dem Node (für die Orphan-Erkennung).
  async listVms() {
    const res = await this.client.get(`/nodes/${this.node}/qemu`);
    return res.data.data || [];
  }

  // Weicher Neustart des Gasts (ACPI/Guest-Agent). Nutzt den
  // reboot-Endpunkt statt stop+start, damit Windows sauber herunterfährt.
  async rebootVm(vmid) {
    const res = await this.client.post(`/nodes/${this.node}/qemu/${vmid}/status/reboot`);
    await this.waitForTask(res.data.data);
  }

  // Auslastung des Proxmox-Nodes (CPU-Anteil 0..1, Speicher in Bytes,
  // Storage-Belegung des Root-Storage). Für die Kapazitätsanzeige im
  // Dashboard. Wirft nicht bei fehlenden Feldern - liefert dann null.
  async getNodeStatus() {
    const res = await this.client.get(`/nodes/${this.node}/status`);
    const d = res.data.data || {};
    const mem = d.memory || {};
    const rootfs = d.rootfs || {};
    return {
      node: this.node,
      cpu: typeof d.cpu === 'number' ? d.cpu : null,
      cpuCount: d.cpuinfo && d.cpuinfo.cpus ? d.cpuinfo.cpus : null,
      memTotal: mem.total ?? null,
      memUsed: mem.used ?? null,
      storageTotal: rootfs.total ?? null,
      storageUsed: rootfs.used ?? null,
      uptimeSeconds: d.uptime ?? null,
      loadavg: Array.isArray(d.loadavg) ? d.loadavg : null,
    };
  }

  // Wartet, bis der QEMU Guest Agent im Windows-Gast antwortet.
  async waitForGuestAgent(vmid, { timeoutMs = 5 * 60 * 1000, intervalMs = 3000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        await this.client.post(`/nodes/${this.node}/qemu/${vmid}/agent/ping`);
        return true;
      } catch (err) {
        // Agent antwortet noch nicht - normal kurz nach dem Booten.
        await sleep(intervalMs);
      }
    }
    throw new Error(`Guest Agent von VM ${vmid} antwortet nicht innerhalb von ${timeoutMs}ms`);
  }

  async getGuestIpAddress(vmid) {
    const res = await this.client.get(`/nodes/${this.node}/qemu/${vmid}/agent/network-get-interfaces`);
    const interfaces = res.data.data.result || [];
    for (const iface of interfaces) {
      if (!iface['ip-addresses']) continue;
      if (/^(lo|loopback)/i.test(iface.name || '')) continue;
      for (const addr of iface['ip-addresses']) {
        if (addr['ip-address-type'] === 'ipv4' && !addr['ip-address'].startsWith('169.254.')) {
          return addr['ip-address'];
        }
      }
    }
    throw new Error(`Keine IPv4-Adresse für VM ${vmid} gefunden`);
  }

  async execInGuest(vmid, commandArray) {
    const res = await this.client.post(`/nodes/${this.node}/qemu/${vmid}/agent/exec`, {
      command: commandArray,
    });
    return res.data.data.pid;
  }

  async waitForExec(vmid, pid, { timeoutMs = 2 * 60 * 1000, intervalMs = 2000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await this.client.get(`/nodes/${this.node}/qemu/${vmid}/agent/exec-status`, {
        params: { pid },
      });
      const status = res.data.data;
      if (status.exited) {
        return status;
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timeout beim Warten auf Guest-Exec (pid ${pid}) auf VM ${vmid}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { ProxmoxClient };
