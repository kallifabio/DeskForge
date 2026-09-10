<#
.SYNOPSIS
    Registriert diese Windows-VM automatisch als Kasm-Workspaces-Server.

.DESCRIPTION
    Wird vom Provisioning-Service per QEMU-Guest-Agent-Exec aufgerufen,
    nachdem eine frische VM aus dem Proxmox-Template geklont und gestartet
    wurde. Das Skript:

      1. Importiert die interne CA in den Windows-Zertifikatspeicher
         (Trusted Root Certification Authorities), damit die HTTPS-
         Verbindung zu Kasm funktioniert - inklusive des "Check-in"-
         Signals. Ohne diesen Schritt wird die VM von Kasm nach rund
         einer Stunde automatisch wieder verworfen ("Require Check-in"),
         weil das Signal nie ankommt.

      2. Startet den bereits im Image vorinstallierten Kasm-Agent-
         Installer im Silent-Modus mit Hostname + Registrierungs-Token.

    HINWEIS zu geschweiften Klammern:
    Dieses Skript wird NICHT durch Kasms eigene Auto-Scale-Vorlagen
    (User-Data-Templating für AWS/Azure) gejagt, sondern direkt per
    Proxmox-Guest-Agent mit normalen CLI-Parametern ausgeführt - deshalb
    muss hier NICHTS an geschweiften Klammern verdoppelt werden. Nutzt du
    stattdessen Kasms eigenes User-Data-Feld, ersetzt Kasm dort Platz-
    halter per Python-String-Templating ({Platzhalter}) - dann muss jede
    *literale* { und } im Skript verdoppelt werden ({{ }}), sonst
    kollidiert das mit PowerShell-Syntax (Scriptblöcke, Hashtables etc.).

.PARAMETER KasmHostname
    Hostname/FQDN des Kasm-Servers (Web-App-Rolle).

.PARAMETER RegistrationToken
    Registrierungs-Token/JWT, das der Provisioning-Service frisch über
    die Kasm-API (create_server + get_servers) geholt hat.

.PARAMETER CaCertPath
    Pfad zu einem bereits im Image liegenden CA-Zertifikat.

.PARAMETER InstallerPath
    Pfad zum im Golden Image vorinstallierten Kasm-Agent-Installer.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$KasmHostname,

    [Parameter(Mandatory = $true)]
    [string]$RegistrationToken,

    [string]$CaCertPath = "C:\ProvisionAgent\ca.crt",

    [string]$InstallerPath = "C:\ProvisionAgent\KasmDesktopServiceInstaller.exe"
)

$ErrorActionPreference = "Stop"
$LogFile = "C:\ProvisionAgent\register-vm.log"

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line
    Write-Output $line
}

Write-Log "Starte Registrierung gegen Kasm-Host '$KasmHostname'."

# --- Schritt 1: Interne CA importieren --------------------------------
if (Test-Path $CaCertPath) {
    try {
        Import-Certificate -FilePath $CaCertPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
        Write-Log "Interne CA aus '$CaCertPath' erfolgreich in Trusted Root importiert."
    } catch {
        Write-Log "WARNUNG: CA-Import fehlgeschlagen: $($_.Exception.Message)"
    }
} else {
    Write-Log "WARNUNG: CA-Zertifikat unter '$CaCertPath' nicht gefunden - HTTPS-Check-in an Kasm kann fehlschlagen, falls das Kasm-Zertifikat von dieser CA signiert ist."
}

# --- Schritt 2: Kasm-Agent registrieren -------------------------------
if (-not (Test-Path $InstallerPath)) {
    Write-Log "FEHLER: Installer nicht gefunden unter '$InstallerPath'. Muss im Golden Image vorbereitet werden."
    exit 1
}

# Die exakten Silent-Parameter hängen von der Installer-Version ab - im
# Zweifel per '<installer>.exe /?' bzw. gegen die Kasm-Dokumentation für
# die eingesetzte Version prüfen, bevor das Image final "eingefroren" wird.
$installerArgs = @(
    "/S",
    "/KASM_HOSTNAME=$KasmHostname",
    "/REGISTRATION_TOKEN=$RegistrationToken"
)

Write-Log "Starte Kasm-Agent-Installer..."
$process = Start-Process -FilePath $InstallerPath -ArgumentList $installerArgs -Wait -PassThru -NoNewWindow

if ($process.ExitCode -ne 0) {
    Write-Log "FEHLER: Installer beendete sich mit Exit-Code $($process.ExitCode)."
    exit $process.ExitCode
}

Write-Log "Registrierung abgeschlossen."
exit 0
