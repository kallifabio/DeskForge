#!/usr/bin/env bash
#
# issue-cert.sh
#
# Stellt ein Server-Zertifikat aus, signiert von der internen Root-CA
# (siehe generate-root-ca.sh).
#
# Aufruf:
#   ./issue-cert.sh <Name> <SAN1,SAN2,...> [CA-Verzeichnis]
#
# Beispiel:
#   ./issue-cert.sh authentik authentik.deskforge.local,10.0.0.5 ./ca-output
#
# IPs und DNS-Namen werden automatisch erkannt und korrekt als IP.x bzw.
# DNS.x in die subjectAltName-Extension einsortiert.

set -euo pipefail

NAME="${1:?Name fehlt, z.B. authentik}"
SANS="${2:?SANs fehlen, z.B. authentik.local,10.0.0.5}"
CA_DIR="${3:-./ca-output}"
OUT_DIR="${CA_DIR}/certs/${NAME}"

mkdir -p "$OUT_DIR"

openssl genrsa -out "${OUT_DIR}/${NAME}.key" 2048

SAN_CONFIG="$(mktemp)"
{
  echo "[req]"
  echo "distinguished_name = dn"
  echo "req_extensions     = v3_req"
  echo "prompt             = no"
  echo "[dn]"
  echo "CN = ${NAME}"
  echo "[v3_req]"
  echo "basicConstraints = CA:FALSE"
  echo "keyUsage         = critical,digitalSignature,keyEncipherment"
  echo "extendedKeyUsage = serverAuth,clientAuth"
  echo "subjectAltName   = @alt_names"
  echo "[alt_names]"
  i=1
  IFS=',' read -ra SAN_ARR <<< "$SANS"
  for san in "${SAN_ARR[@]}"; do
    if [[ "$san" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "IP.${i} = ${san}"
    else
      echo "DNS.${i} = ${san}"
    fi
    i=$((i + 1))
  done
} > "$SAN_CONFIG"

openssl req -new -key "${OUT_DIR}/${NAME}.key" -out "${OUT_DIR}/${NAME}.csr" -config "$SAN_CONFIG"

openssl x509 -req -in "${OUT_DIR}/${NAME}.csr" \
  -CA "${CA_DIR}/ca.crt" -CAkey "${CA_DIR}/ca.key" -CAserial "${CA_DIR}/ca.srl" \
  -days 825 -sha256 -extfile "$SAN_CONFIG" -extensions v3_req \
  -out "${OUT_DIR}/${NAME}.crt"

rm -f "$SAN_CONFIG" "${OUT_DIR}/${NAME}.csr"

echo "==> Zertifikat erstellt: ${OUT_DIR}/${NAME}.crt"
echo "    Key:                ${OUT_DIR}/${NAME}.key"
echo ""
echo "Denk daran, ${CA_DIR}/ca.crt als Trust-Anchor in jedem beteiligten"
echo "System zu hinterlegen (inkl. Docker-Containern, siehe docs/SETUP.md,"
echo "Abschnitt 'Zertifikate & Docker-Container')."
