#!/usr/bin/env bash
#
# generate-root-ca.sh
#
# Erzeugt (oder erneuert) eine interne Root-CA für die VDI-Umgebung.
#
# Löst gezielt ein Problem aus der Praxis: Authentik (und andere moderne
# Software) verweigert Zertifikatsketten, wenn die "Basic Constraints" im
# CA-Zertifikat nicht als "critical" markiert sind. Viele einfache
# openssl-Einzeiler setzen dieses Flag nicht - dieses Skript tut es bewusst.
#
# Aufruf:
#   ./generate-root-ca.sh [Ausgabeverzeichnis]
#
# Wird das Skript ein zweites Mal mit demselben Ausgabeverzeichnis
# aufgerufen, wird der vorhandene Private Key UND die vorhandene
# Seriennummer weiterverwendet. Das ist wichtig, wenn eine bestehende CA
# nachträglich mit korrekten Extensions neu ausgestellt werden muss, ohne
# bereits ausgestellte Zertifikate zu gefährden.

set -euo pipefail

CA_DIR="${1:-./ca-output}"
CA_CN="${CA_CN:-Interne DeskForge Root-CA}"
DAYS="${CA_DAYS:-3650}"

mkdir -p "$CA_DIR"
cd "$CA_DIR"

if [ -f ca.key ]; then
  echo "==> Bestehender CA-Key gefunden, wird weiterverwendet (Private Key wird NIE automatisch neu erzeugt)."
else
  echo "==> Erzeuge neuen 4096-bit CA-Key..."
  openssl genrsa -out ca.key 4096
fi

CONFIG_FILE="$(mktemp)"
cat > "$CONFIG_FILE" << EOF
[req]
distinguished_name = dn
x509_extensions    = v3_ca
prompt             = no

[dn]
CN = ${CA_CN}

[v3_ca]
basicConstraints     = critical,CA:TRUE,pathlen:0
keyUsage             = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF

if [ -f ca.srl ]; then
  EXISTING_SERIAL="$(cat ca.srl)"
  echo "==> Verwende bestehende Seriennummer 0x${EXISTING_SERIAL} weiter."
  SERIAL_ARGS=(-set_serial "0x${EXISTING_SERIAL}")
else
  echo "01" > ca.srl
  echo "==> Neue CA, starte mit Seriennummer 0x01."
  SERIAL_ARGS=(-set_serial 0x01)
fi

openssl req -x509 -new -key ca.key -days "$DAYS" -sha256 \
  -config "$CONFIG_FILE" "${SERIAL_ARGS[@]}" -out ca.crt

rm -f "$CONFIG_FILE"

echo ""
echo "==> Fertig."
echo "    Zertifikat : $CA_DIR/ca.crt"
echo "    Private Key: $CA_DIR/ca.key   (NICHT ins Git-Repo committen!)"
echo ""
echo "Basic Constraints sind hier bewusst 'critical' - das war im Original-"
echo "Setup nicht der Fall und wurde von Authentik mit einem Vertrauensfehler"
echo "quittiert. Dieses Zertifikat (ca.crt) muss als Trust-Anchor in allen"
echo "beteiligten Systemen hinterlegt werden (siehe docs/SETUP.md)."
