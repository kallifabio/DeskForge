#!/bin/sh
set -e

if [ -f "${CA_CERT_PATH:-/certs/ca.crt}" ]; then
  echo "==> Importiere interne CA in den Container-Trust-Store..."
  cp "${CA_CERT_PATH:-/certs/ca.crt}" /usr/local/share/ca-certificates/internal-deskforge-ca.crt
  update-ca-certificates
else
  echo "==> WARNUNG: Kein CA-Zertifikat unter ${CA_CERT_PATH:-/certs/ca.crt} gefunden."
  echo "    HTTPS-Aufrufe an Proxmox/Kasm mit interner CA werden vermutlich fehlschlagen."
fi

exec "$@"
