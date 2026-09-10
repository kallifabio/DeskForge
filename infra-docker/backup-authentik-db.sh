#!/usr/bin/env bash
#
# backup-authentik-db.sh
#
# Sichert die Authentik-/OpenLDAP-Postgres-Datenbank als komprimierten
# SQL-Dump. Für den regelmäßigen Betrieb per Cron einplanen, z.B. täglich
# um 03:00 Uhr:
#
#   0 3 * * *  cd /opt/deskforge/infra-docker && ./backup-authentik-db.sh /mnt/backup
#
# Alte Backups (älter als BACKUP_RETENTION_DAYS) werden automatisch
# gelöscht.

set -euo pipefail

BACKUP_DIR="${1:?Zielverzeichnis fehlt, z.B. ./backup-authentik-db.sh /mnt/backup}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"

mkdir -p "$BACKUP_DIR"

echo "==> Erzeuge Dump der Authentik-Datenbank..."
docker compose exec -T postgresql pg_dump -U authentik -d authentik \
  | gzip > "${BACKUP_DIR}/authentik-db_${TIMESTAMP}.sql.gz"

echo "==> Dump gespeichert unter ${BACKUP_DIR}/authentik-db_${TIMESTAMP}.sql.gz"

echo "==> Entferne Backups älter als ${BACKUP_RETENTION_DAYS} Tage..."
find "$BACKUP_DIR" -name "authentik-db_*.sql.gz" -mtime "+${BACKUP_RETENTION_DAYS}" -delete

echo "==> Fertig."
echo ""
echo "Wiederherstellung im Notfall:"
echo "  gunzip -c ${BACKUP_DIR}/authentik-db_${TIMESTAMP}.sql.gz | docker compose exec -T postgresql psql -U authentik -d authentik"
