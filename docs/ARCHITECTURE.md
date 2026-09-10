# Architekturübersicht

```
                    ┌─────────────────────────┐
                    │      Nutzer-Browser      │
                    └────────────┬─────────────┘
                                 │  1. Anmeldung
                                 v
                    ┌─────────────────────────┐
                    │   Dashboard (Node.js)    │  <-- OIDC-Client
                    └───────┬─────────┬────────┘
                            │         │
                 2. SSO     │         │  4. "Neue VM anfordern"
                            v         v
                 ┌──────────────┐  ┌─────────────────────────┐
                 │  Authentik    │  │ Provisioning-Service     │
                 │  (OIDC / SSO) │  │ (Node.js)                │
                 └──────┬───────┘  └─────┬──────────┬────────┘
                        │                │          │
                 3. Verzeichnis   5. Klonen/    6. Server anlegen +
                    Abgleich      Starten VM      Registrierungs-Token
                        │                │          │
                        v                v          v
                 ┌──────────────┐  ┌───────────┐  ┌──────────────┐
                 │  OpenLDAP     │  │ Proxmox VE │  │ Kasm          │
                 │  (Benutzer)   │  │ (Hypervisor)│  │ Workspaces    │
                 └──────────────┘  └─────┬─────┘  └──────┬───────┘
                                          │                │
                                    7. Guest-Agent-Exec:   │
                                    register-vm.ps1 <───────┘
                                    (CA importieren +
                                     Kasm-Agent registrieren)
```

Alle TLS-Verbindungen zwischen diesen Komponenten werden von einer
gemeinsamen internen Root-CA signiert (siehe `ca/`). Diese CA muss auf
jedem beteiligten System (Docker-Container, Windows-Golden-Image, ggf.
Admin-Arbeitsplätze) als Trust-Anchor hinterlegt sein.

Die vollständige, schrittweise Einrichtung steht in `docs/SETUP.md`, eine
Empfehlung für passende Server-Hardware in `docs/SERVER-EMPFEHLUNG.md`.
