# Vollständige Einrichtungsanleitung

Diese Anleitung führt Schritt für Schritt durch den kompletten Aufbau: vom
gemieteten Server bis zum fertigen Dashboard mit Pool, Idle-Abbau,
Nutzerprofilen, Monitoring und Backups.

## Inhalt

1. [Server vorbereiten](#1-server-vorbereiten)
2. [Proxmox VE installieren](#2-proxmox-ve-installieren)
3. [Interne CA erzeugen](#3-interne-ca-erzeugen)
4. [Proxmox-API-Rolle einrichten](#4-proxmox-api-rolle-einrichten)
5. [Kasm Workspaces installieren](#5-kasm-workspaces-installieren)
6. [Docker-Stack starten (LDAP, Authentik, Samba, Monitoring)](#6-docker-stack-starten-ldap-authentik-samba-monitoring)
7. [Authentik konfigurieren](#7-authentik-konfigurieren)
8. [Windows-Golden-Image vorbereiten](#8-windows-golden-image-vorbereiten)
9. [Provisioning-Service einrichten](#9-provisioning-service-einrichten)
10. [Dashboard einrichten](#10-dashboard-einrichten)
11. [Dauerhafter Betrieb (systemd)](#11-dauerhafter-betrieb-systemd)
12. [Backups einrichten](#12-backups-einrichten)
13. [Monitoring einrichten](#13-monitoring-einrichten)
14. [Nutzerprofile mit FSLogix (optional, empfohlen)](#14-nutzerprofile-mit-fslogix-optional-empfohlen)
15. [Weiterführend: Lizenzierung & Skalierung](#15-weiterführend-lizenzierung--skalierung)
16. [Optional: Reverse-Proxy mit echtem TLS-Zertifikat](#16-optional-reverse-proxy-mit-echtem-tls-zertifikat)

---

## 1. Server vorbereiten

Server gemäß `docs/SERVER-EMPFEHLUNG.md` bestellen. Nach der Bestellung:

1. Server per SSH als `root` erreichbar machen (bei Hetzner: Zugangsdaten
   kommen per E-Mail, danach direkt `ssh root@<server-ip>`).
2. Aktuelles Debian 12 (Bookworm) als Betriebssystem installieren (bei
   Hetzner über die Rescue-System-Funktion `installimage` in Robot
   auswählbar, alternativ eigenes ISO einbinden). Debian 12 ist die von
   Proxmox VE offiziell unterstützte Basis.
3. System aktualisieren:
   ```
   apt update && apt full-upgrade -y
   reboot
   ```
4. Statische IP-Adresse und Hostname/FQDN prüfen (Proxmox benötigt einen
   auflösbaren Hostnamen):
   ```
   hostnamectl set-hostname pve.deskforge.local
   ```
   In `/etc/hosts` die Zeile mit der öffentlichen IP und `pve.deskforge.local`
   ergänzen, falls noch nicht vorhanden.
5. Das komplette Repository auf den Server bringen, z.B.:
   ```
   git clone <dein-repo-oder-entpacktes-zip> /opt/deskforge
   cd /opt/deskforge
   ```
   Alle folgenden Pfadangaben beziehen sich auf dieses Verzeichnis.
6. Node.js 22 installieren (wird für Provisioning-Service und Dashboard
   gebraucht, unabhängig davon, ob sie später als systemd-Dienst oder in
   Docker laufen sollen):
   ```
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs
   node --version   # sollte v22.x anzeigen
   ```

## 2. Proxmox VE installieren

Offizieller Weg: Proxmox-VE-Pakete auf das bestehende Debian 12 aufsetzen
(kein Neuinstallieren nötig).

1. Proxmox-Paketquelle einrichten:
   ```
   echo "deb [arch=amd64] http://download.proxmox.com/debian/pve bookworm pve-no-subscription" > /etc/apt/sources.list.d/pve-install-repo.list
   wget https://enterprise.proxmox.com/debian/proxmox-release-bookworm.gpg -O /etc/apt/trusted.gpg.d/proxmox-release-bookworm.gpg
   apt update && apt full-upgrade -y
   ```
2. Proxmox VE installieren:
   ```
   apt install proxmox-ve postfix open-iscsi -y
   ```
   Bei der Postfix-Abfrage reicht „Internet Site“ mit dem Hostnamen als
   Vorschlag.
3. Neu starten und in den neuen Proxmox-Kernel booten:
   ```
   reboot
   ```
4. Proxmox-Weboberfläche aufrufen: `https://<server-ip>:8006` (Login:
   `root` + dein Passwort).
5. Netzwerkbrücke prüfen: Unter *Datacenter -> <Hostname> -> System ->
   Network* sollte bereits eine Bridge `vmbr0` existieren.
6. **Storage-Entscheidung für später (Schritt 9) treffen:** Soll
   `PROXMOX_CLONE_MODE=linked` genutzt werden (schnellere, platzsparende
   Klone), muss der Storage, auf dem das Windows-Template liegt,
   Snapshots unterstützen (LVM-thin, ZFS, Ceph RBD oder qcow2 auf
   Directory-Storage). Bei klassischem LVM/Raw-Storage bei
   `PROXMOX_CLONE_MODE=full` (Standard) bleiben.

## 3. Interne CA erzeugen

```
cd ca
./generate-root-ca.sh ./ca-output
./issue-cert.sh authentik authentik.deskforge.local,10.0.0.5 ./ca-output
./issue-cert.sh openldap openldap.deskforge.local,10.0.0.6 ./ca-output
./issue-cert.sh kasm kasm.deskforge.local,10.0.0.7 ./ca-output
./issue-cert.sh dashboard dashboard.deskforge.local,10.0.0.8 ./ca-output
cd ..
```

Ersetze die Beispiel-Hostnamen/IPs durch deine tatsächlichen Adressen.
`ca/ca-output/ca.crt` ist ab jetzt der zentrale Trust-Anchor - er muss
überall dort importiert werden, wo eine TLS-Verbindung zu einem dieser
Dienste aufgebaut wird:

- **Docker-Container** (Authentik, Provisioning-Service): wird über
  Volume-Mounts erledigt, siehe Schritt 6 und 9.
- **Windows-Golden-Image**: siehe Schritt 8.
- **Dein eigener Rechner** (um die Admin-Oberflächen ohne
  Zertifikatswarnung zu öffnen): `ca.crt` in den Browser-/Betriebssystem-
  Zertifikatspeicher importieren (unter Windows: Doppelklick auf die
  Datei -> Zertifikat installieren -> Lokaler Computer ->
  Vertrauenswürdige Stammzertifizierungsstellen).

## 4. Proxmox-API-Rolle einrichten

Auf dem Proxmox-Host als `root`:

```
cd proxmox
./setup-api-role.sh
cd ..
```

Das ausgegebene Token-Secret sofort notieren - es erscheint nur einmal.
Du brauchst gleich zwei Werte für `provisioning-service/.env`:

- `PROXMOX_TOKEN_ID` (z.B. `deskforge-provisioner@pve!provisioning`)
- `PROXMOX_TOKEN_SECRET` (das gerade angezeigte Secret)

## 5. Kasm Workspaces installieren

Auf einem eigenen Server oder einer eigenen VM (nicht im Docker-Stack aus
Schritt 6):

1. Aktuelle Version und den passenden Installationsbefehl von
   `https://kasm.com/downloads` bzw. `https://docs.kasm.com` kopieren
   (die genaue Versionsnummer/Dateiname ändert sich regelmäßig). Das
   Muster sieht so aus:
   ```
   cd /tmp
   curl -O https://kasm-static-content.s3.amazonaws.com/kasm_release_<VERSION>.tar.gz
   tar -xf kasm_release_<VERSION>.tar.gz
   sudo bash kasm_release/install.sh
   ```
2. Der Installer fragt EULA, Zeitzone etc. ab und zeigt am Ende die
   Zugangsdaten für `https://<KASM-SERVER>` an (Standard-Login
   `admin@kasm.local`, Passwort wird zufällig generiert - sofort
   notieren).
3. In der Kasm-Admin-Oberfläche:
   - *Access -> Users* -> eigenen Admin-Account mit echter E-Mail
     anlegen, Standard-Konto danach deaktivieren.
   - *Access -> API Keys -> Add API Key* -> alle benötigten
     Berechtigungen aktivieren (mindestens: Servers
     View/Create/Modify/Delete, Zones View, Sessions View). `api_key`
     und `api_key_secret` notieren - werden zu `KASM_API_KEY` /
     `KASM_API_KEY_SECRET` in `provisioning-service/.env`.
   - *Infrastructure -> Zones* -> vorhandene „default“-Zone öffnen, die
     `zone_id` notieren (wird `KASM_ZONE_ID`).
   - Kasm-Agent-Installer für Windows herunterladen (unter
     *Infrastructure -> Servers -> Add Server*, je nach Version als
     „Download Agent“-Link) - wird in Schritt 8 gebraucht.
4. Das eigene Kasm-TLS-Zertifikat durch das mit `issue-cert.sh kasm ...`
   erzeugte ersetzen (Pfad je nach Kasm-Version unter
   `/opt/kasm/current/certs/`, danach den passenden Neustart-Befehl aus
   der Kasm-Dokumentation ausführen).

## 6. Docker-Stack starten (LDAP, Authentik, Samba, Monitoring)

```
cd infra-docker
cp .env.example .env
```

`.env` öffnen und ausfüllen:
- `LDAP_ADMIN_PASSWORD`, `PG_PASS`, `AUTHENTIK_SECRET_KEY`,
  `SAMBA_FSLOGIX_SERVICE_PASSWORD` mit echten, zufälligen Werten füllen,
  z.B.:
  ```
  openssl rand -base64 36 | tr -d '\n'   # für PG_PASS
  openssl rand -base64 60 | tr -d '\n'   # für AUTHENTIK_SECRET_KEY
  ```
- `CA_CERT_PATH` zeigt standardmäßig auf `../ca/ca-output/ca.crt` - passt,
  wenn `ca/` und `infra-docker/` wie im Repo nebeneinanderliegen.

Bevor der Stack startet, müssen die in Schritt 3 erzeugten
OpenLDAP-Zertifikate an der im `docker-compose.yml` erwarteten Stelle
liegen (`ca/ca-output/certs/openldap/openldap.crt` und `.key` - wurden
durch `issue-cert.sh openldap ...` bereits genau dort erzeugt).

Stack starten (Authentik/LDAP für den Login, Samba für Nutzerprofile,
Uptime Kuma für Monitoring):
```
docker compose up -d
docker compose logs -f
```

Nach dem ersten Start ist Authentik unter `https://<server-ip>:9443`
erreichbar. Der Ersteinrichtungsassistent läuft unter
`/if/flow/initial-setup/` - dort einen Admin-Account anlegen.

Samba und Uptime Kuma sind zu diesem Zeitpunkt technisch nutzbar, werden
aber erst in Schritt 13 und 14 tatsächlich konfiguriert - an dieser
Stelle reicht es, dass sie fehlerfrei starten
(`docker compose ps` sollte alle Dienste als "running" zeigen).

## 7. Authentik konfigurieren

### 7.1 LDAP als Nutzerquelle einbinden (optional, falls Nutzer zentral in
OpenLDAP gepflegt werden sollen)

1. *Directory -> Federation & Social login -> Create* -> Typ „LDAP
   Source“ wählen.
2. Felder ausfüllen:
   - **Server URI**: `ldap://openldap:389` (Docker-interner Name) oder
     `ldaps://openldap:636`, falls TLS erzwungen werden soll.
   - **Bind CN**: `cn=admin,dc=deskforge,dc=local`
   - **Bind Password**: dein `LDAP_ADMIN_PASSWORD`
   - **Base DN**: `dc=deskforge,dc=local`
3. Speichern, danach über den Button „Sync now“ einen ersten Abgleich
   anstoßen. Neue LDAP-Nutzer erscheinen danach unter *Directory ->
   Users*.

### 7.2 Admin-Gruppe für das Dashboard anlegen

1. *Directory -> Groups -> Create* -> Name `deskforge-admins` (muss exakt zu
   `AUTHENTIK_ADMIN_GROUP` in `dashboard/.env` passen, Standardwert ist
   bereits `deskforge-admins`).
2. Die Nutzer, die im Dashboard die Admin-Ansicht (alle Nutzer, alle
   Sitzungen, alle VMs, für andere provisionieren) sehen sollen, dieser
   Gruppe zuweisen (*Directory -> Users -> <Nutzer> -> Groups*). Alle
   anderen Nutzer sehen im Dashboard nur ihre eigene
   Selbstbedienungs-Ansicht.

### 7.3 OIDC-Provider für das Dashboard anlegen

1. *Applications -> Providers -> Create* -> Typ „OAuth2/OpenID Provider“.
2. Felder ausfüllen:
   - **Name**: `deskforge-dashboard`
   - **Authorization flow**: Standard-Flow belassen (z.B.
     `default-provider-authorization-implicit-consent`)
   - **Client type**: `Confidential`
   - **Redirect URIs**: `http://<dashboard-host>:5000/auth/callback`
     (bzw. deine echte Dashboard-URL, falls hinter Reverse-Proxy)
3. **Wichtig - "groups"-Scope aktivieren:** Im selben Provider unter
   *Advanced protocol settings -> Scopes* sicherstellen, dass neben
   `openid`, `profile`, `email` auch `authentik default OAuth Mapping:
   OpenID 'openid'` UND der Gruppen-Mapping-Eintrag (in aktuellen
   Authentik-Versionen meist bereits als Standard-Scope-Mapping
   „authentik default OAuth Mapping: OpenID 'openid'“ oder ein separater
   `groups`-Eintrag verfügbar) ausgewählt ist. Ohne diesen Schritt liefert
   Authentik keinen `groups`-Claim, und JEDER angemeldete Nutzer landet
   im Dashboard in der eingeschränkten Nicht-Admin-Ansicht. Nach dem
   Speichern zur Kontrolle einmal ausloggen/einloggen und in den
   Server-Logs des Dashboards (`journalctl -u deskforge-dashboard` bzw.
   `docker logs`) nachsehen, ob `groups` im Log auftaucht, falls die
   Admin-Erkennung nicht wie erwartet funktioniert.
4. Speichern - Authentik zeigt jetzt **Client ID** und **Client Secret**
   an. Beide notieren, werden zu `AUTHENTIK_CLIENT_ID` /
   `AUTHENTIK_CLIENT_SECRET` in `dashboard/.env`.
5. *Applications -> Applications -> Create* -> Name `DeskForge Dashboard`, den
   gerade angelegten Provider auswählen, Slug z.B. `deskforge-dashboard`
   vergeben.
6. `AUTHENTIK_ISSUER_URL` in `dashboard/.env` setzt sich zusammen aus
   `https://<authentik-host>:9443/application/o/<slug>/` - der Slug muss
   exakt zum eben vergebenen passen.

## 8. Windows-Golden-Image vorbereiten

Ausführliche Checkliste in `windows-agent/GOLDEN-IMAGE-CHECKLIST.md`
(inkl. Lizenzierung, FSLogix). Kurzfassung:

1. In Proxmox eine neue Windows-VM anlegen (VMID notieren, z.B. `9000`).
   Windows-Edition bewusst wählen - siehe
   `docs/WINDOWS-LIZENZIERUNG.md`, bevor lizenzpflichtige Schritte
   folgen.
2. Windows installieren, VirtIO-Treiber-ISO einbinden, QEMU Guest Agent
   installieren, Dienst auf „Automatisch“ stellen.
3. Ordner `C:\ProvisionAgent\` anlegen, darin ablegen:
   - `windows-agent/register-vm.ps1`
   - `ca/ca-output/ca.crt`
   - den in Schritt 5 heruntergeladenen Kasm-Agent-Installer, umbenannt
     zu `KasmDesktopServiceInstaller.exe`
4. Optional, aber empfohlen: FSLogix einrichten, siehe
   `docs/FSLOGIX-PROFILE-CONTAINERS.md` (nutzt den in Schritt 6
   gestarteten Samba-Dienst als Profil-Share).
5. Windows generalisieren (Sysprep), VM herunterfahren.
6. In der Proxmox-Oberfläche die VM per Rechtsklick in eine Vorlage
   umwandeln (oder per CLI: `qm template 9000`).
7. Die VMID (`9000`) in `provisioning-service/.env` als
   `PROXMOX_TEMPLATE_VMID` eintragen.

## 9. Provisioning-Service einrichten

Auf einem Server mit Netzwerkzugriff auf Proxmox und Kasm (kann derselbe
Host wie Authentik sein).

```
cd provisioning-service
cp .env.example .env
```

`.env` mit den bisher gesammelten Werten ausfüllen. Neu seit der
letzten Überarbeitung:

- `PROVISIONING_API_KEY` - gemeinsamer Schlüssel mit dem Dashboard,
  erzeugen mit `openssl rand -hex 32`. Denselben Wert gleich für
  `dashboard/.env` notieren.
- `PROXMOX_CLONE_MODE` - `full` (Standard) oder `linked` (siehe Schritt
  2, Storage-Entscheidung).
- `POOL_SIZE` - wie viele fertig gestartete VMs ständig vorgehalten
  werden (0 = kein Pool, jede Anfrage klont live und dauert mehrere
  Minuten).
- `IDLE_TIMEOUT_MINUTES` - nach wie vielen Minuten ohne aktive
  Kasm-Sitzung eine zugewiesene VM automatisch abgebaut wird.

Abhängigkeiten installieren, Tests laufen lassen (prüft u.a. die
Konfigurationsvalidierung, ohne dass eine echte Proxmox-/Kasm-Verbindung
nötig ist) und den Dienst lokal testen:
```
npm install
npm test
node src/server.js
```

Funktionstest in einem zweiten Terminal:
```
curl -X POST http://localhost:4000/provision \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <dein PROVISIONING_API_KEY>" \
  -d '{"username":"testuser"}'
```
Das sollte (je nachdem, ob eine Pool-VM bereitsteht, nach Sekunden bis
wenigen Minuten) eine JSON-Antwort mit `vmid`, `ip` und `kasmServerId`
liefern. In der Kasm-Oberfläche unter *Infrastructure -> Servers* sollte
der neue Eintrag erscheinen. Zum Aufräumen:
```
curl -X POST http://localhost:4000/deprovision \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <dein PROVISIONING_API_KEY>" \
  -d '{"username":"testuser"}'
```

**Firewall nicht vergessen:** Port 4000 sollte NICHT aus dem öffentlichen
Internet erreichbar sein, sondern nur vom Dashboard-Host aus. Der
API-Key schützt zusätzlich, ersetzt aber keine Netzwerk-Firewall.

Für den Dauerbetrieb per Docker **muss der Build-Kontext das komplette
Repository-Wurzelverzeichnis sein** (nicht nur `provisioning-service/`),
weil das Image auch den `shared/`-Ordner braucht:
```
cd /opt/deskforge          # Repository-Wurzel, NICHT provisioning-service/
docker build -f provisioning-service/Dockerfile -t deskforge-provisioning-service .
docker run -d --name provisioning-service \
  --env-file provisioning-service/.env \
  -v $(pwd)/ca/ca-output/ca.crt:/certs/ca.crt:ro \
  -v deskforge-provisioning-data:/app/data \
  -p 4000:4000 \
  deskforge-provisioning-service
```
Das Volume `deskforge-provisioning-data` hält `state.json` (Pool-/Zuweisungs-
Zustand) über Container-Neustarts hinweg am Leben.

## 10. Dashboard einrichten

```
cd dashboard
cp .env.example .env
```

`.env` ausfüllen. Das Dashboard braucht seit der Umstellung auf den
zentralen Provisioning-Service **keine eigenen Proxmox-/Kasm-
Zugangsdaten mehr** - nur noch:
- die Authentik-Werte aus Schritt 7.3,
- `AUTHENTIK_ADMIN_GROUP` (Standard `deskforge-admins`, muss zur in Schritt 7.2
  angelegten Gruppe passen),
- die LDAP-Werte aus Schritt 7.1,
- `PROVISIONING_SERVICE_URL` (z.B. `http://10.0.0.9:4000`) und
  `PROVISIONING_API_KEY` - **muss exakt mit dem Wert aus Schritt 9
  übereinstimmen.**

Abhängigkeiten installieren, Tests laufen lassen, Tailwind-CSS bauen und
starten:
```
npm install
npm test
npm run build:css
npm start
```
(`npm start` baut das CSS über den `prestart`-Hook automatisch mit, der
separate Aufruf oben dient nur der Kontrolle, dass der Build funktioniert.)

Dashboard unter `http://localhost:5000` öffnen - die Anmeldung leitet
automatisch zu Authentik weiter. Mitglieder der `deskforge-admins`-Gruppe sehen
die volle Admin-Ansicht, alle anderen nur ihre eigene VDI-Sitzung.

## 11. Dauerhafter Betrieb (systemd)

Für Provisioning-Service und Dashboard empfiehlt sich je ein systemd-Unit.
Beispiel für den Provisioning-Service unter
`/etc/systemd/system/deskforge-provisioning.service`:

```ini
[Unit]
Description=DeskForge Provisioning Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/deskforge/provisioning-service
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
EnvironmentFile=/opt/deskforge/provisioning-service/.env

[Install]
WantedBy=multi-user.target
```

Danach:
```
systemctl daemon-reload
systemctl enable --now deskforge-provisioning.service
journalctl -u deskforge-provisioning -f   # Logs live mitverfolgen
```

Für das Dashboard analog unter `/etc/systemd/system/deskforge-dashboard.service`,
`WorkingDirectory` zeigt auf `dashboard/`. Da `npm start` das CSS über
`prestart` neu baut, entweder `ExecStart=/usr/bin/npm start` verwenden
oder einmalig manuell `npm run build:css` ausführen und direkt
`ExecStart=/usr/bin/node src/server.js` nutzen.

## 12. Backups einrichten

Siehe `docs/BACKUP.md` für die vollständige Anleitung. Kurzfassung: CA-
Private-Key offline & verschlüsselt sichern (nicht automatisieren),
Proxmox-`vzdump`-Backups für das Golden Image einrichten, und
`infra-docker/backup-authentik-db.sh` per Cron für die Authentik-
Datenbank einplanen.

## 13. Monitoring einrichten

Siehe `docs/MONITORING.md`. Kurzfassung: Uptime Kuma läuft bereits aus
Schritt 6 (`http://<host>:3001`) - dort für Provisioning-Service,
Dashboard, Authentik, Kasm, Proxmox und OpenLDAP je einen Monitor
anlegen und einen Alarmweg (E-Mail o.ä.) hinterlegen.

## 14. Nutzerprofile mit FSLogix (optional, empfohlen)

Siehe `docs/FSLOGIX-PROFILE-CONTAINERS.md`. Ohne diesen Schritt gehen bei
jedem VM-Abbau (Idle-Timeout oder manuelles Stoppen) alle lokalen
Profildaten des Nutzers verloren - für einen produktiven Mehrnutzer-
Betrieb ist dieser Schritt praktisch Pflicht.

## 15. Weiterführend: Lizenzierung & Skalierung

- `docs/WINDOWS-LIZENZIERUNG.md` - vor dem produktiven Einsatz lesen,
  betrifft Compliance, nicht nur Technik.
- `docs/SKALIERUNG.md` - Ausbaupfad, sobald ein einzelner Server nicht
  mehr reicht (Kasm-Multi-Server, Authentik-Replikate, Proxmox-Cluster).

## 16. Optional: Reverse-Proxy mit echtem TLS-Zertifikat

Die interne CA aus Schritt 3 eignet sich für die Kommunikation zwischen
den Diensten untereinander (Proxmox-API, Guest-Agent, Kasm-API,
Dashboard-zu-Provisioning-Service). Sollen Nutzer das Dashboard oder Kasm
jedoch über eine echte, öffentliche Domain ohne Zertifikatswarnung
erreichen, empfiehlt sich zusätzlich ein Reverse-Proxy mit automatischem
Let's-Encrypt-Zertifikat davor (z.B. Caddy oder nginx + certbot), der nur
die nach außen sichtbaren Ports (Dashboard, Kasm-WebApp, Authentik)
terminiert. Die interne CA bleibt davon unberührt und wird weiterhin für
die Backend-zu-Backend-Kommunikation verwendet.
