# Windows-Lizenzierung für diese VDI-Umgebung

Dieses Toolkit spart Lizenzkosten für die Virtualisierungs-Schicht
(Proxmox VE statt VMware vSphere, Kasm Workspaces statt kommerzieller
VDI-Broker). Das ändert nichts daran, dass **jede Windows-VM weiterhin
eine gültige Windows-Lizenz braucht** - dieser Punkt fehlte bisher
komplett in der Anleitung.

**Wichtig: Dies ist eine technische Einordnung, keine Rechts- oder
Lizenzberatung.** Microsofts Lizenzbedingungen sind komplex, ändern sich
regelmäßig und hängen vom genauen Einsatzszenario ab (eigene Mitarbeiter
vs. externe Kunden, vorhandene Volumenlizenzverträge, Cloud- vs.
On-Premise-Betrieb). Für eine verbindliche Einschätzung der eigenen
Situation empfiehlt sich Rücksprache mit einem Microsoft-Lizenzpartner
(LSP) oder direkt mit Microsoft.

## Die zentrale Weichenstellung: Desktop-OS oder Server-OS?

### Option A: Windows 10/11 (Desktop-Edition) als VDI-Gast

Windows-10/11-Desktop-Lizenzen sind grundsätzlich für die Installation
auf **einem** Gerät gedacht. Für den Zugriff per Fernzugriff/VDI auf eine
Windows-10/11-VM von einem *anderen* Endgerät aus verlangt Microsoft
zusätzliche Nutzungsrechte, die üblicherweise als **VDA (Virtual Desktop
Access)** bezeichnet werden - entweder separat erworben oder als Teil
bestimmter Microsoft-365-/Windows-Enterprise-Abonnements enthalten. Ohne
ein solches berechtigendes Abonnement ist der in diesem Toolkit gebaute
Anwendungsfall (zentrale Windows-Desktop-VM, Zugriff von einem anderen
Client über Kasm) lizenzrechtlich in der Regel NICHT ohne Weiteres
abgedeckt.

### Option B: Windows Server mit Remote Desktop Services (RDS)

Der für Mehrnutzer-Fernzugriff **explizit vorgesehene** Weg ist Windows
Server mit installierter RDS-Rolle. Dafür werden zwei getrennte
Lizenzbausteine gebraucht:

1. **Windows-Server-Lizenz** für den Host/die VM selbst (nach Kernen
   lizenziert, Details je nach Server-Version).
2. **RDS-Zugriffslizenzen (RDS-CALs)** - pro Nutzer ODER pro Gerät, dazu
   passend gewählt je nachdem, ob dieselbe Person von wechselnden
   Geräten zugreift (dann Per-User-CAL sinnvoller) oder feste
   Arbeitsplatzrechner mehrere Nutzer teilen (dann Per-Device-CAL). CALs
   werden zusätzlich zur Server-Lizenz benötigt und über einen
   Remote-Desktop-Lizenzserver verwaltet/aktiviert.

Für den in diesem Toolkit gebauten Anwendungsfall (mehrere Mitarbeiter,
zentrale Windows-Umgebung, Zugriff per Browser/Client über Kasm) ist
**Option B in der Praxis meist die passendere und eindeutiger lizenzierte
Wahl**, auch wenn Windows Server ungewohnter wirkt als ein normales
Windows-10/11-Desktop-Image.

## Was das für dieses Toolkit konkret bedeutet

- Bei der Erstellung des Golden Images (siehe
  `windows-agent/GOLDEN-IMAGE-CHECKLIST.md`) bewusst entscheiden, welche
  Windows-Edition eingesetzt wird, und die passenden Lizenzen/CALs VOR
  dem Produktivbetrieb beschaffen.
- Bei Windows Server zusätzlich einen RDS-Lizenzserver einrichten und
  innerhalb der Testphase (Grace Period, üblicherweise 120 Tage ab
  RDS-Rolleninstallation) mit echten CALs versorgen.
- Die Anzahl gleichzeitig benötigter CALs orientiert sich an der Zahl
  gleichzeitig aktiver Sitzungen - dieselbe Kennzahl, die auch für die
  Server-Dimensionierung in `docs/SERVER-EMPFEHLUNG.md` verwendet wird.
- Lizenzkosten in die Gesamtrechnung mit einbeziehen: Die in diesem
  Projekt eingesparten Kosten betreffen ausschließlich die
  Virtualisierungs-/VDI-Broker-Schicht (vorher VMware/kommerzieller VDI-
  Anbieter), nicht die Windows-Lizenzen selbst.

## Weiterführende, offizielle Quellen

Da sich Lizenzbedingungen ändern, im Zweifel direkt bei Microsoft
nachsehen: die offizielle „Microsoft Product Terms“-Dokumentation sowie
die RDS- und VDA-Lizenzierungsseiten von Microsoft geben die jeweils
aktuellen, verbindlichen Bedingungen wieder.
