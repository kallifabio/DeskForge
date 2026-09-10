#!/usr/bin/env bash
#
# setup-api-role.sh
#
# Legt eine dedizierte Rolle, einen technischen Benutzer und ein API-Token
# für den Provisioning-Service an. Auf dem Proxmox-Host als root ausführen.
#
# Hintergrund: Proxmox VE 9 hat die Berechtigungen deutlich feiner
# aufgeteilt als frühere Versionen. Alte, pauschale Rollen reichen oft nicht
# mehr aus - insbesondere für die Kommunikation mit dem QEMU Guest Agent
# (nötig, um nach dem Klonen automatisch die IP-Adresse der neuen VM zu
# ermitteln). Diese Liste an Privilegien deckt Klonen, Starten, Stoppen,
# Löschen und Guest-Agent-Kommunikation ab.
#
# WICHTIG: Je nach genauer Proxmox-Version/Patchlevel können einzelne
# Privilegien anders heißen oder zusätzlich nötig sein. Prüfe im Zweifel
# unter "Datacenter -> Permissions -> Roles" in der Proxmox-Oberfläche,
# welche Privilegien in deiner Version verfügbar sind.

set -euo pipefail

ROLE_NAME="${1:-DeskForgeProvisioner}"
USER_NAME="${2:-deskforge-provisioner@pve}"
TOKEN_ID="${3:-provisioning}"

PRIVS="VM.Allocate,VM.Clone,VM.Config.CDROM,VM.Config.CPU,VM.Config.Disk,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.PowerMgmt,VM.Audit,VM.Monitor,Datastore.AllocateSpace,Datastore.Audit,Sys.Audit"

echo "==> Lege Rolle '${ROLE_NAME}' an..."
pveum role add "${ROLE_NAME}" -privs "${PRIVS}" \
  || echo "    (Rolle existiert evtl. schon - wird weiterverwendet, Privilegien ggf. manuell prüfen)"

echo "==> Lege technischen Benutzer '${USER_NAME}' an..."
pveum user add "${USER_NAME}" --comment "Technischer Nutzer für den DeskForge-Provisioning-Service" \
  || echo "    (Nutzer existiert evtl. schon)"

echo "==> Weise Rolle auf Ressourcenpfad '/' zu..."
pveum aclmod / -user "${USER_NAME}" -role "${ROLE_NAME}"

echo "==> Erzeuge API-Token '${TOKEN_ID}'..."
pveum user token add "${USER_NAME}" "${TOKEN_ID}" --privsep 0

echo ""
echo "=================================================================="
echo "WICHTIG: Das Token-Secret ('value' aus der Ausgabe oben) wird nur"
echo "         EINMAL angezeigt. Trage es sofort in"
echo "         provisioning-service/.env als PROXMOX_TOKEN_SECRET ein."
echo ""
echo "PROXMOX_TOKEN_ID sollte dann lauten: ${USER_NAME}!${TOKEN_ID}"
echo "=================================================================="
