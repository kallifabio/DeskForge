# Monitoring & Alerting

Bislang gab es keinerlei Überwachung - fällt Kasm, Authentik oder der
Provisioning-Service aus, bemerkt das sonst niemand, bis sich ein Nutzer
meldet. `infra-docker/docker-compose.yml` bringt dafür **Uptime Kuma**
mit, einen leichtgewichtigen, selbst gehosteten Monitoring-Dienst.

## Einrichtung

```
cd infra-docker
docker compose up -d uptime-kuma
```

Oberfläche unter `http://<host>:3001` öffnen, Admin-Account anlegen,
danach für jede Kernkomponente einen Monitor einrichten:

| Komponente             | Monitor-Typ | Ziel                                          |
| ------------------------ | ----------- | ---------------------------------------------- |
| Provisioning-Service      | HTTP(s)     | `http://<host>:4000/health`                    |
| Dashboard                 | HTTP(s)     | `http://<host>:5000/health`                    |
| Authentik                 | HTTP(s)     | `https://<authentik-host>:9443/-/health/live/` |
| Kasm Workspaces           | HTTP(s)     | `https://<kasm-host>/api/public/get_zones` (Antwortcode reicht, kein Login nötig) |
| Proxmox VE                | HTTP(s)     | `https://<proxmox-host>:8006`                  |
| OpenLDAP                  | TCP-Port    | `<openldap-host>:389`                          |

Für jeden Monitor unter *Notifications* einen Alarmweg hinterlegen (z.B.
E-Mail, Slack, Telegram - Uptime Kuma unterstützt viele gängige Kanäle
direkt in der Oberfläche).

## Was das NICHT abdeckt

Uptime Kuma prüft nur "ist der Dienst erreichbar", nicht Ressourcen-
Auslastung (CPU/RAM/Storage der Proxmox-Hosts) oder Anwendungs-Metriken
(wie viele VMs gerade im Pool, wie viele Idle-Reaper-Läufe fehlgeschlagen
sind). Für tiefere Einblicke wäre ein Prometheus+Grafana-Stack der
nächste Ausbauschritt - deutlich aufwändiger einzurichten und für die
Größenordnung dieses Projekts zunächst nicht zwingend nötig. Proxmox VE
bringt für die reine Ressourcenauslastung bereits eigene Grafiken in der
Weboberfläche mit (*Datacenter -> Node -> Summary*), die für den Einstieg
oft ausreichen.
