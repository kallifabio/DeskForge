# Backup-Strategie

Bislang hatte dieses Toolkit keinerlei Backup-Vorgaben - hier die
wichtigsten drei Bausteine, sortiert nach Kritikalität.

## 1. CA-Private-Key (höchste Priorität, keine Automatisierung!)

Geht `ca/ca-output/ca.key` verloren, müssen ALLE Zertifikate in der
gesamten Umgebung neu ausgestellt und überall neu verteilt werden
(Authentik, OpenLDAP, Kasm, jede Windows-VM, jeder Admin-Rechner). Das
ist der teuerste Single-Point-of-Failure im ganzen Setup.

**Bewusst NICHT automatisiert sichern** (ein automatisches Backup an
einen Online-Speicherort würde das Risiko eher erhöhen als senken):

1. Nach dem Erzeugen der CA (`ca/generate-root-ca.sh`) `ca.key` UND
   `ca.crt` einmalig auf einen verschlüsselten, getrennten Datenträger
   kopieren (z.B. verschlüsselter USB-Stick, Passwort-Manager mit
   Datei-Anhang-Funktion, offline gelagerter Tresor).
2. Diese Kopie an einem zweiten, physisch getrennten Ort aufbewahren.
3. Bei jeder Neuausstellung (`generate-root-ca.sh` mit bestehendem
   Verzeichnis) die Offline-Kopie aktuell halten - passiert aber nur
   beim bewussten Neu-Signieren, siehe Kommentare im Skript.

## 2. Proxmox-VM-Backups

Proxmox VE bringt eine eigene, ausgereifte Backup-Funktion (`vzdump`)
mit - eine eigene Lösung dafür zu bauen wäre unnötig. Eingerichtet wird
sie direkt in der Proxmox-Oberfläche:

1. *Datacenter -> Backup -> Add* - Zeitplan festlegen (z.B. nächtlich).
2. Als Ziel-Storage eine externe Storage-Box einbinden (siehe
   `docs/SERVER-EMPFEHLUNG.md`) - dazu in Proxmox unter *Datacenter ->
   Storage -> Add -> NFS bzw. CIFS* die Storage Box als Ziel hinzufügen,
   BEVOR der Backup-Job angelegt wird.
3. Backups mindestens für das Windows-Golden-Image (Vorlage) einrichten -
   das ist die eigentlich "wertvolle", manuell aufgebaute VM. Laufende,
   vom Provisioning-Service selbst erzeugte VMs sind dagegen bewusst
   wegwerfbar (siehe Idle-Reaper) und müssen in der Regel NICHT
   gesichert werden, sofern Nutzerprofile bereits über FSLogix
   (`docs/FSLOGIX-PROFILE-CONTAINERS.md`) ausgelagert sind.
4. Den Aufbewahrungszeitraum (*Prune Options*) passend zur verfügbaren
   Storage-Box-Größe setzen.

## 3. Authentik-/OpenLDAP-Datenbank

Enthält alle Nutzerkonten, Gruppenmitgliedschaften und SSO-Konfiguration.
`infra-docker/backup-authentik-db.sh` erzeugt einen komprimierten
`pg_dump` und kann direkt per Cron eingeplant werden:

```
crontab -e
# Täglich um 03:00 Uhr, Backups 14 Tage aufbewahren:
0 3 * * *  cd /opt/deskforge/infra-docker && ./backup-authentik-db.sh /mnt/backup >> /var/log/deskforge-backup.log 2>&1
```

Das Skript räumt ältere Backups automatisch auf
(`BACKUP_RETENTION_DAYS`, Standard 14 Tage). Die Wiederherstellung ist im
Skript-Output nach jedem Lauf dokumentiert.

Zusätzlich sinnvoll: das OpenLDAP-Datenverzeichnis (Docker-Volume
`ldap_data`) regelmäßig mit sichern, z.B. per `docker run --rm -v
ldap_data:/data -v /mnt/backup:/backup alpine tar czf
/backup/ldap-data_$(date +%F).tar.gz /data`.

## 4. Provisioning-Service-Zustand

`provisioning-service/data/state.json` enthält, welche VMs aktuell wem
zugewiesen sind. Geht diese Datei verloren, "vergisst" der Dienst
laufende Zuweisungen (die VMs selbst bleiben davon unberührt, aber der
Idle-Reaper und die Pool-Logik starten quasi bei null). Ein tägliches
Kopieren dieser einen kleinen JSON-Datei ins Backup-Ziel reicht aus - sie
ist klein und ändert sich nur bei Provisioning-/Deprovisioning-Vorgängen.
