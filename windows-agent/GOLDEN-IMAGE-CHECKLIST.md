# Checkliste: Windows-Golden-Image für Proxmox + Kasm

Diese Schritte einmalig im Windows-Template (Proxmox-VMID, die in
`PROXMOX_TEMPLATE_VMID` konfiguriert ist) vorbereiten, dann das Template
„einfrieren“ (Proxmox: `qm template <vmid>`):

1. **Windows-Lizenz aktivieren** (Volumenlizenz oder passende
   Einzelplatz-/Server-Lizenz je nach Nutzungsszenario) - siehe
   `docs/WINDOWS-LIZENZIERUNG.md`, BEVOR das Image generalisiert wird.

2. **QEMU Guest Agent installieren und Dienst aktivieren.**
   Ohne laufenden Guest Agent kann der Provisioning-Service weder die
   IP-Adresse ermitteln noch `register-vm.ps1` ausführen.

3. **Ordner `C:\ProvisionAgent\` anlegen** und darin ablegen:
   - `register-vm.ps1` (aus diesem Verzeichnis)
   - `ca.crt` (die Root-CA aus `ca/ca-output/ca.crt`)
   - den Kasm-Agent-Installer, umbenannt zu
     `KasmDesktopServiceInstaller.exe`
   - optional, für dauerhafte Nutzerprofile: `configure-fslogix.ps1` +
     `FSLogixAppsSetup.exe` (siehe `docs/FSLOGIX-PROFILE-CONTAINERS.md`)

4. **Optional: FSLogix einrichten** (empfohlen, sobald mehrere Nutzer
   dieselbe Art VM nacheinander bekommen sollen):
   ```powershell
   .\configure-fslogix.ps1 -ShareUncPath "\\<samba-host-ip>\profiles"
   ```

5. **Sysprep/Generalisierung** wie für Proxmox-Windows-Templates üblich
   durchführen, damit jeder Klon eine eigene Identität bekommt.

6. **Nicht** den Kasm-Agent bereits im Template registrieren - das
   passiert erst automatisch beim ersten Boot eines Klons durch
   `register-vm.ps1`, gesteuert vom Provisioning-Service.

7. Template einfrieren:
   ```
   qm template <PROXMOX_TEMPLATE_VMID>
   ```

8. **Storage prüfen, falls `PROXMOX_CLONE_MODE=linked` genutzt werden
   soll**: Linked Clones brauchen thin-provisionierten Storage
   (LVM-thin, ZFS, Ceph RBD oder qcow2 auf Directory-Storage). Auf
   klassischem LVM (nicht thin) oder Raw-Storage funktionieren nur volle
   Klone (`PROXMOX_CLONE_MODE=full`, Standardeinstellung).
