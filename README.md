# DeskForge: Selbst gehostete VDI-Umgebung ohne Lizenzkosten

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat&logo=express&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![Proxmox VE](https://img.shields.io/badge/Proxmox_VE-9-E57000?style=flat&logo=proxmox&logoColor=white)
![Authentik](https://img.shields.io/badge/Authentik-SSO%20%2F%20OIDC-FD4B2D?style=flat&logo=authentik&logoColor=white)
![Kasm Workspaces](https://img.shields.io/badge/Kasm-Workspaces-1D9BF0?style=flat)
![Docker Compose](https://img.shields.io/badge/Docker%20Compose-infra-2496ED?style=flat&logo=docker&logoColor=white)
![Tests](https://img.shields.io/badge/tests-node%20--test-4B32C3?style=flat)
![License](https://img.shields.io/badge/license-not%20specified-lightgrey?style=flat)

Setup-/Deploy-Automatisierung + automatisches Windows-VM-Provisioning
(mit VM-Pool, Idle-Auto-Abbau, Nutzerprofilen) + rollenbasiertes
Verwaltungs-Dashboard (Tailwind CSS + Font Awesome) für eine
VDI-Umgebung aus **OpenLDAP + Authentik + Proxmox VE + Kasm Workspaces**.

Dieses Toolkit bildet die im zugrunde liegenden Video beschriebene
Architektur nach und baut gezielt Lösungen für die dort beschriebenen
Stolpersteine ein (CA/Basic-Constraints, Docker-Trust-Store,
Proxmox-9-Berechtigungen, Kasm-Check-in, Kollision zwischen
Kasm-Templating und PowerShell-Klammern) - und geht seit der letzten
Überarbeitung deutlich über den ursprünglichen Prototyp hinaus (siehe
"Was seit der ersten Version dazugekommen ist" unten).

**Ausführliche Anleitungen:**
- [`docs/SETUP.md`](docs/SETUP.md) - komplette Einrichtung, Schritt für
  Schritt, von der Server-Bestellung bis zum laufenden Dashboard.
- [`docs/SERVER-EMPFEHLUNG.md`](docs/SERVER-EMPFEHLUNG.md) - welche
  Server-Hardware für wie viele gleichzeitige Nutzer sinnvoll ist.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - Architekturübersicht
  als Diagramm.
- [`docs/FSLOGIX-PROFILE-CONTAINERS.md`](docs/FSLOGIX-PROFILE-CONTAINERS.md) -
  Nutzerprofile, die einen VM-Abbau überleben.
- [`docs/WINDOWS-LIZENZIERUNG.md`](docs/WINDOWS-LIZENZIERUNG.md) - welche
  Windows-Lizenz für welches Szenario nötig ist.
- [`docs/BACKUP.md`](docs/BACKUP.md) - CA-Key, Proxmox-VMs,
  Authentik-Datenbank sichern.
- [`docs/MONITORING.md`](docs/MONITORING.md) - Uptime Kuma einrichten.
- [`docs/SKALIERUNG.md`](docs/SKALIERUNG.md) - Ausbaupfad über einen
  einzelnen Server hinaus.

## Was hier NICHT enthalten ist (bewusst)

- **Kasm Workspaces selbst** wird nicht containerisiert. Kasm bringt einen
  eigenen offiziellen Installer mit und läuft am besten auf einem
  dedizierten Host bzw. einer eigenen VM (siehe `docs/SETUP.md`,
  Abschnitt 5).
- **Proxmox VE** ist ein Hypervisor-Host, kein Container - ebenfalls
  vorausgesetzt (siehe `docs/SETUP.md`, Abschnitt 2).
- Exakte API-Feldnamen/Endpunkte von Kasm können sich zwischen Versionen
  leicht unterscheiden. Wo relevant, ist das im Code kommentiert und mit
  einer Fallback-Strategie versehen (siehe `shared/kasmClient.js`).

## Projektstruktur

```
shared/                Von beiden Services genutzte Proxmox-/Kasm-Clients,
                        Mutex, Retry-Helfer, API-Key-Middleware
ca/                     Interne Root-CA erzeugen + Server-Zertifikate ausstellen
proxmox/                Proxmox-API-Rolle/Token einrichten
infra-docker/           Docker-Compose-Stack: OpenLDAP + Authentik + Samba
                        (FSLogix-Share) + Uptime Kuma (Monitoring)
provisioning-service/   Node.js-Dienst: verwaltet VM-Pool, Zuweisung,
                        automatischen Idle-Abbau, spricht als einzige
                        Komponente direkt mit Proxmox + Kasm
windows-agent/          PowerShell-Skripte fürs Windows-Golden-Image
                        (Kasm-Registrierung, FSLogix-Konfiguration)
dashboard/              Rollenbasiertes Node.js-Dashboard (Tailwind CSS +
                        Font Awesome), spricht nur noch mit dem
                        Provisioning-Service + LDAP + Authentik
docs/                   Ausführliche Anleitungen (siehe Liste oben)
```

## Schnellstart (Kurzfassung - Details in docs/SETUP.md)

1. `ca/generate-root-ca.sh` + `ca/issue-cert.sh` - interne CA erzeugen
2. `proxmox/setup-api-role.sh` - API-Rolle auf dem Proxmox-Host anlegen
3. Kasm Workspaces per offiziellem Installer aufsetzen
4. `infra-docker/docker-compose.yml` - OpenLDAP + Authentik + Samba +
   Uptime Kuma starten, in Authentik LDAP-Quelle, Admin-Gruppe
   (`deskforge-admins`) und OIDC-Provider (mit "groups"-Scope!) für das
   Dashboard anlegen
5. Windows-Golden-Image gemäß `windows-agent/GOLDEN-IMAGE-CHECKLIST.md`
   vorbereiten (inkl. optionalem FSLogix-Schritt) und als Proxmox-
   Vorlage einfrieren
6. `provisioning-service` konfigurieren (`.env`, u.a. gemeinsamer
   `PROVISIONING_API_KEY`), `npm test`, dann starten
7. `dashboard` konfigurieren (`.env`, derselbe `PROVISIONING_API_KEY`),
   `npm test`, `npm run build:css`, dann starten

**Wichtig beim Docker-Build des Provisioning-Service:** Das Image braucht
sowohl `provisioning-service/` als auch das gemeinsame `shared/`-
Verzeichnis eine Ebene darüber. Der Build-Kontext muss deshalb das
Repository-Wurzelverzeichnis sein, nicht `provisioning-service/` allein:
```
cd deskforge   # Repository-Wurzel
docker build -f provisioning-service/Dockerfile -t deskforge-provisioning-service .
```

## Was seit der ersten Version dazugekommen ist

Die ursprüngliche Fassung dieses Toolkits war ein reiner Prototyp (klont
VM, registriert bei Kasm, fertig - kein Rückbau, keine Auth zwischen den
eigenen Diensten, keine Tests). Mittlerweile:

- **Deprovisioning + Idle-Auto-Abbau**: zugewiesene VMs werden nach
  konfigurierbarer Leerlaufzeit automatisch wieder abgebaut
  (`provisioning-service/src/jobs/idleReaper.js`).
- **VM-Pool**: vorgewärmte, bereits gestartete VMs stehen sofort zur
  Verfügung, statt bei jeder Anfrage mehrere Minuten auf einen frischen
  Klon zu warten (`src/jobs/poolMaintainer.js`).
- **VMID-Race-Condition behoben** über einen In-Process-Mutex um
  VMID-Vergabe + Klon-Anstoß (`shared/mutex.js`).
- **API-Key-Pflicht** zwischen Dashboard und Provisioning-Service
  (`shared/apiKeyAuth.js`) statt offenem Vertrauen übers Netzwerk.
- **Rollenmodell im Dashboard**: normale Nutzer sehen nur ihre eigene
  Sitzung, Mitglieder der Authentik-Gruppe `deskforge-admins` sehen die volle
  Übersicht und können für andere provisionieren.
- **Keine doppelten API-Clients mehr**: Proxmox-/Kasm-Logik existiert
  einmalig in `shared/`, das Dashboard hat gar keine eigenen
  Proxmox-/Kasm-Zugangsdaten mehr - alles läuft über den
  Provisioning-Service.
- **Strukturiertes Logging** (pino) statt `console.log`, **zod**-
  Konfigurationsvalidierung mit gesammelten, verständlichen
  Fehlermeldungen statt Abbruch bei der ersten fehlenden Variable.
- **Automatisierte Tests** (`npm test` in beiden Services, Node
  Built-in-Testrunner) für die kniffligsten Logikteile: Mutex, Retry,
  Kasm-Feld-Fallback, Config-Validierung, State-Store-Nebenläufigkeit,
  Auth-Middleware, HTTP-Routen.
- **Nutzerprofile via FSLogix**, die einen VM-Abbau überleben, statt
  jedes Mal bei null anzufangen.
- **Backup-, Monitoring- und Skalierungs-Dokumentation**, die vorher
  komplett fehlte.
- **Windows-Lizenzierung** wird jetzt explizit angesprochen, statt
  stillschweigend vorausgesetzt.

## Zertifikate & Docker-Container

Ein Docker-Container sieht **nicht automatisch** den Zertifikats-Trust-Store
des Host-Systems - genau das hat im Original-Setup dazu geführt, dass der
Provisioning-Container Proxmox nicht per HTTPS erreichen konnte, obwohl die
CA auf dem Host längst importiert war. Deshalb kopiert
`provisioning-service/Dockerfile` `ca.crt` explizit in den
Container-Trust-Store und setzt zusätzlich `NODE_EXTRA_CA_CERTS`.

## Proxmox-9-Berechtigungen

Proxmox VE 9 hat die Berechtigungen deutlich feiner aufgeteilt als frühere
Versionen. `proxmox/setup-api-role.sh` legt eine Rolle mit allen
Privilegien an, die für Klonen, Starten, Löschen und
Guest-Agent-Kommunikation nötig sind. Falls in eurer genauen
Version/eurem Patchlevel dennoch Berechtigungsfehler auftreten: In der
Proxmox-Oberfläche unter „Datacenter -> Permissions -> Roles“ nachsehen,
welche Privilegien tatsächlich verfügbar sind, und die Liste in
`setup-api-role.sh` entsprechend anpassen.

## Kasm „Require Check-in“ / automatisches Löschen nach 1 Stunde

Kasm erwartet nach dem Erstellen eines Servers ein aktives Signal
(„Check-in“), bevor er als einsatzbereit gilt - kommt es nicht, wird der
Eintrag nach einer Stunde verworfen. Das Signal scheitert typischerweise an
fehlendem TLS-Vertrauen zwischen VM und Kasm-Server. `register-vm.ps1`
importiert deshalb als allerersten Schritt die interne CA in den
Windows-Zertifikatspeicher, bevor der Kasm-Agent gestartet wird.

## Sicherheitshinweise

- `.env`-Dateien nie committen (enthalten API-Secrets, Passwörter).
- CA-Private-Key (`ca.key`) nur auf vertrauenswürdigen Systemen aufbewahren,
  zusätzlich offline sichern (siehe `docs/BACKUP.md`).
- Der technische Proxmox-Benutzer sollte ausschließlich die in
  `setup-api-role.sh` definierten Privilegien besitzen, nicht mehr.
- `PROVISIONING_API_KEY` mit `openssl rand -hex 32` erzeugen, in
  Dashboard und Provisioning-Service identisch eintragen, Port 4000
  (Provisioning-Service) nicht öffentlich erreichbar machen.

## Tests ausführen

```
cd provisioning-service && npm install && npm test
cd ../dashboard && npm install && npm test
```

Beide Testsuiten laufen ohne echte Proxmox-/Kasm-/LDAP-Verbindung (Mocks
bzw. reine Logik-/Validierungstests) und sollten vor jedem Deployment
grün sein.

**End-to-End (Dashboard-Frontend):**

```
cd dashboard
npx playwright install chromium   # einmalig
npm run e2e
```

Die E2E-Tests (`dashboard/e2e/`) fahren das Frontend gegen `dev-server.js`
(gemockte `/api/*`-Endpunkte) und decken die kritischen Abläufe ab:
Verbinden/Verlängern/Beenden, Template-Auswahl, Admin-Karten (Status,
Kapazität, Audit, Nutzung, Orphans), API-Tokens, geplante Anforderungen,
Filter/Sortierung, Farbschema, Ankündigungsbanner.
