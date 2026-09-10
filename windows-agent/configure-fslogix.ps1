<#
.SYNOPSIS
    Installiert FSLogix Profile Containers und richtet sie auf einen
    Netzwerk-Share ein - läuft einmalig im Windows-Golden-Image, NICHT
    bei jeder VM-Zuweisung (im Gegensatz zu register-vm.ps1).

.DESCRIPTION
    FSLogix speichert das komplette Nutzerprofil als VHD(X)-Datei auf
    einem Netzlaufwerk und hängt es beim Login automatisch ein - genau
    das Werkzeug, um "VM ist wegwerfbar, Profil überlebt" umzusetzen,
    ohne eine eigene Lösung zu bauen.

    Lizenzhinweis: FSLogix ist ohne separate Zusatzkosten nutzbar, wenn
    eine berechtigende Microsoft-Lizenz vorliegt (z.B. bestimmte
    Microsoft-365-Pläne, RDS-CAL mit Software Assurance, oder im Rahmen
    von Azure Virtual Desktop). Das ändert sich gelegentlich - vor dem
    Einsatz die aktuellen FSLogix-Lizenzbedingungen von Microsoft prüfen
    (siehe docs/WINDOWS-LIZENZIERUNG.md).

    Voraussetzung: Der FSLogix-Installer (von
    https://aka.ms/fslogix-latest heruntergeladen) liegt bereits unter
    C:\ProvisionAgent\FSLogixAppsSetup.exe.

.PARAMETER ShareUncPath
    UNC-Pfad zum Profil-Share, z.B. \\10.0.0.9\profiles

.PARAMETER InstallerPath
    Pfad zum FSLogix-Installer im Golden Image.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ShareUncPath,

    [string]$InstallerPath = "C:\ProvisionAgent\FSLogixAppsSetup.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InstallerPath)) {
    Write-Error "FSLogix-Installer nicht gefunden unter '$InstallerPath'. Von https://aka.ms/fslogix-latest herunterladen und ins Golden Image legen."
    exit 1
}

Write-Output "Installiere FSLogix..."
Start-Process -FilePath $InstallerPath -ArgumentList "/install", "/quiet", "/norestart" -Wait

$regPath = "HKLM:\SOFTWARE\FSLogix\Profiles"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}

# Kernkonfiguration für Profile Containers. Details und weitere Optionen
# (z.B. Cloud-Cache für mehrere Standorte) siehe Microsoft-FSLogix-Doku.
Set-ItemProperty -Path $regPath -Name "Enabled" -Value 1 -Type DWord
Set-ItemProperty -Path $regPath -Name "VHDLocations" -Value $ShareUncPath -Type MultiString
Set-ItemProperty -Path $regPath -Name "IsDynamic" -Value 1 -Type DWord
Set-ItemProperty -Path $regPath -Name "SizeInMBs" -Value 30000 -Type DWord
Set-ItemProperty -Path $regPath -Name "VolumeType" -Value "VHDX" -Type String
Set-ItemProperty -Path $regPath -Name "DeleteLocalProfileWhenVHDShouldApply" -Value 1 -Type DWord
Set-ItemProperty -Path $regPath -Name "FlipFlopProfileDirectoryName" -Value 1 -Type DWord

Write-Output "FSLogix konfiguriert. Profil-Share: $ShareUncPath"
Write-Output "WICHTIG: Prüfen, dass der technische Rechnerkonto-/Nutzerzugriff auf den Share funktioniert (siehe docs/FSLOGIX-PROFILE-CONTAINERS.md)."
