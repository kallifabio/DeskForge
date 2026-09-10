# Nutzerprofile mit FSLogix (überlebt VM-Abbau)

Löst den offenen Punkt aus der Haupt-README: Windows-VMs in diesem
Toolkit sind bewusst wegwerfbar (werden nach Leerlauf oder manuellem
Stoppen wieder abgebaut, siehe Idle-Reaper im Provisioning-Service).
FSLogix sorgt dafür, dass das Nutzerprofil trotzdem erhalten bleibt: es
liegt als VHD(X)-Datei auf einem Netzlaufwerk und wird bei jedem Login
automatisch in die jeweils zugewiesene VM eingehängt.

## Lizenzhinweis

FSLogix ist kostenlos nutzbar, sofern eine berechtigende Microsoft-Lizenz
vorliegt (u.a. bestimmte Microsoft-365-Pläne, RDS-CAL mit Software
Assurance, oder im Rahmen von Azure Virtual Desktop). Diese Bedingungen
ändern sich gelegentlich - vor dem produktiven Einsatz die aktuellen
FSLogix-Lizenzbedingungen direkt bei Microsoft prüfen (siehe auch
`docs/WINDOWS-LIZENZIERUNG.md`). Diese Anleitung ist eine technische
Beschreibung, keine Rechtsberatung.

## Architekturentscheidung: Samba vs. echter Windows-Dateiserver

Dieses Toolkit bringt einen Samba-Container (`infra-docker/docker-compose.yml`,
Dienst `samba`) als **selbst gehostete, pragmatische** Lösung mit. Wichtig
zu wissen:

- Samba emuliert NTFS-Zugriffsrechte über `vfs objects = acl_xattr` nur
  eingeschränkt. Für kleine Teams/Homelab-Betrieb funktioniert das in der
  Praxis meist gut, ist aber nicht die von Microsoft offiziell für
  FSLogix qualifizierte Konfiguration.
- Microsofts empfohlener, robusterer Weg ist ein "echter" Windows-
  Dateiserver (oder Azure Files mit nativen NTFS-Rechten). Wer das schon
  im Netz hat, sollte das statt des Samba-Containers verwenden - dann
  einfach `ShareUncPath` in Schritt 3 unten auf diesen Server zeigen
  lassen und den `samba`-Dienst in `docker-compose.yml` weglassen.

## Einrichtung

### 1. Samba-Freigabe starten (falls kein eigener Dateiserver vorhanden)

In `infra-docker/.env` ein Passwort für `SAMBA_FSLOGIX_SERVICE_PASSWORD`
setzen, dann:

```
cd infra-docker
docker compose up -d samba
```

Für jeden echten Nutzer, der FSLogix nutzen soll, in
`docker-compose.yml` eine weitere Zeile nach dem Muster
`ACCOUNT_<name>: "<passwort>"` plus `GROUPS_<name>: "vdiusers"` ergänzen
(Klartext-Passwörter hier sind für den Einstieg okay, für den
Produktivbetrieb unterstützt das Image auch Passwort-Hashes - siehe
`create-hash.sh` im Image). Bei vielen Nutzern lohnt sich stattdessen ein
Skript, das diese Zeilen aus der LDAP-Nutzerliste generiert.

### 2. FSLogix-Installer besorgen

Von `https://aka.ms/fslogix-latest` herunterladen, als
`FSLogixAppsSetup.exe` in den Ordner `C:\ProvisionAgent\` des
Windows-Golden-Images legen (siehe
`windows-agent/GOLDEN-IMAGE-CHECKLIST.md`).

### 3. FSLogix im Golden Image konfigurieren

Im Golden Image (VOR dem Einfrieren zur Vorlage) einmalig ausführen:

```powershell
.\configure-fslogix.ps1 -ShareUncPath "\\<samba-host-ip>\profiles"
```

Das Skript installiert FSLogix und setzt die nötigen Registry-Werte
(`Enabled`, `VHDLocations`, `SizeInMBs` etc.). Details und weitere
Optionen (z.B. Cloud-Cache für mehrere Standorte, Größenbeschränkungen
pro Nutzer) in der offiziellen Microsoft-FSLogix-Dokumentation.

### 4. Testen

Nach dem Einfrieren des Templates und einer neuen Zuweisung: in der VM
einloggen, etwas im Profil ändern (z.B. Desktop-Hintergrund), Sitzung
beenden (VM wird abgebaut), neue Sitzung anfordern - das Profil sollte
unverändert wieder da sein, weil es aus derselben VHDX auf dem Share
geladen wird.

## Bekannte Stolpersteine

- **Zugriff verweigert beim ersten Login**: meist eine Berechtigungsfrage
  auf dem Share (Nutzer/Gruppe fehlt, Passwort falsch) - Samba-Logs
  (`docker compose logs samba`) geben meist die genaue Ursache.
  Server-seitig zusätzlich prüfen, ob der Nutzer in Authentik/LDAP UND im
  Samba-Container mit übereinstimmendem Namen existiert.
- **Profil wird nicht als FSLogix-Container erkannt**: `Get-EventLog` bzw.
  Ereignisanzeige unter "Applications and Services Logs -> Microsoft ->
  FSLogix" auf der jeweiligen VM prüfen.
- **Zu kleine/große VHDX-Größe**: `SizeInMBs` im Registry-Schlüssel bzw.
  im Skript anpassen, bevor sich viele Nutzerprofile angesammelt haben
  (nachträgliches Verkleinern ist bei FSLogix nicht ohne Weiteres möglich).
