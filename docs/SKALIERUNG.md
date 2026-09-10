# Skalierung über einen einzelnen Server hinaus

Die Grundkonfiguration in diesem Toolkit geht von jeweils EINER Instanz
pro Komponente aus - ein Proxmox-Node, ein Kasm-Server, eine
Authentik-Instanz, ein Provisioning-Service. Das ist der richtige
Startpunkt, hat aber logischerweise überall genau einen
Single-Point-of-Failure. Dieser Abschnitt beschreibt den jeweiligen
nächsten Ausbauschritt - bewusst als Anleitung, nicht als vorgefertigtes
Setup, da die passende Lösung stark von der tatsächlichen Last abhängt.

## Kasm Workspaces: natives Multi-Server-Setup

Kasm unterstützt von Haus aus getrennte Rollen (`--role db`, `--role
app`, `--role agent`), die auf unterschiedliche Server verteilt werden
können - im Prinzip die gleiche Installationsroutine wie in
`docs/SETUP.md`, Abschnitt 5, nur mit anderen `--role`-Flags. Kasms
eigene Sizing-Dokumentation empfiehlt für größere Deployments mindestens
zwei Web-App-Server (N+1-Redundanz) hinter einem Load Balancer.
Praktisches Vorgehen:

1. Separaten DB-Server aufsetzen: `install.sh --role db`.
2. Mehrere App-Server aufsetzen: `install.sh --role app` (verweisen auf
   den DB-Server).
3. Load Balancer (z.B. HAProxy oder ein Cloud-Loadbalancer) vor die
   App-Server schalten.
4. Beliebig viele Agent-Server (`--role agent`) für die eigentlichen
   VM-/Container-Sitzungen ergänzen - genau hier setzt auch der
   Provisioning-Service aus diesem Toolkit an (siehe `KASM_ZONE_ID` in
   `provisioning-service/.env`, falls mit mehreren Zonen gearbeitet
   wird).

## Authentik: mehrere Server-/Worker-Replikate

Authentik selbst ist zustandslos genug, um Server und Worker mehrfach zu
betreiben, solange sie dieselbe Postgres-Datenbank nutzen:

```
docker compose up -d --scale authentik-server=2 --scale authentik-worker=2
```

Davor einen Reverse-Proxy/Load-Balancer (z.B. Caddy oder nginx) einrichten,
der die Anfragen auf die mehreren `authentik-server`-Instanzen verteilt -
Docker Compose vergibt den Replikaten automatisch fortlaufende Namen
(`deskforge-authentik-server-1`, `-2`, ...), die im Loadbalancer-Konfig als
Backend-Ziele eingetragen werden.

## Proxmox VE: Cluster statt Einzel-Node

Für mehr Kapazität als ein einzelner Server bieten kann, unterstützt
Proxmox VE natives Clustering (mehrere Nodes, gemeinsam verwaltet über
eine Weboberfläche, mit Live-Migration von VMs zwischen Nodes). Das ist
ein eigenständiges, größeres Thema - die offizielle Proxmox-
Cluster-Dokumentation ist hier der richtige Ausgangspunkt. Der
Provisioning-Service in diesem Toolkit geht aktuell von genau einem
`PROXMOX_NODE` aus; für einen Cluster-Betrieb müsste die
Provisioning-Logik erweitert werden, um VMs auf den jeweils am wenigsten
ausgelasteten Node zu verteilen (Proxmox bietet dafür die
`/cluster/resources`-API als Grundlage).

## Wann sich der Aufwand lohnt

Als Faustregel: Solange ein einzelner Server aus
`docs/SERVER-EMPFEHLUNG.md` ausreicht, lohnt sich die zusätzliche
Komplexität aus diesem Dokument meist noch nicht. Sobald absehbar ist,
dass die Nutzerzahl über das hinauswächst, was ein einzelner Server an
Kernen/RAM liefern kann - oder ein Ausfall eines einzelnen Servers
geschäftskritisch wäre - ist es Zeit, die hier beschriebenen Schritte
anzugehen.
