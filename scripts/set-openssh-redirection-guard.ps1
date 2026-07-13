<#
.SYNOPSIS
Manages RedirectionGuard for the Windows OpenSSH server.

.DESCRIPTION
Reports, disables, or restores the RedirectionGuard process mitigation for
sshd.exe. Disable saves the original MitigationOptions registry value before
clearing only the RedirectionGuard bit. Restore reinstates the saved value.

Run Disable and Restore from an elevated local PowerShell session. Restarting
sshd disconnects active SSH sessions, including Zellij and tools running under
them.

.PARAMETER Action
Selects the operation:

Status displays the current registry values and sshd service state.
Disable backs up MitigationOptions and clears the RedirectionGuard bit.
Restore reinstates the saved MitigationOptions value.

.PARAMETER RestartService
Restarts sshd after Disable or Restore so the change affects new SSH sessions.
Active SSH sessions will disconnect.

.EXAMPLE
PS> .\set-openssh-redirection-guard.ps1 -Action Status

Displays the current configuration without modifying it.

.EXAMPLE
PS> .\set-openssh-redirection-guard.ps1 -Action Disable -RestartService -WhatIf

Previews the registry and service operations without changing the system.

.EXAMPLE
PS> .\set-openssh-redirection-guard.ps1 -Action Disable -RestartService

Backs up the original value, disables RedirectionGuard, and restarts sshd.
Run this command from an elevated local PowerShell session.

.EXAMPLE
PS> .\set-openssh-redirection-guard.ps1 -Action Restore -RestartService

Restores the saved value and restarts sshd.

.NOTES
The backup is stored beside MitigationOptions as
MitigationOptionsChezmoiBackup. The script refuses to overwrite unexpected
registry values instead of guessing how to restore them.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet("Status", "Disable", "Restore")]
    [string]$Action = "Status",
    [switch]$RestartService
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
    throw "This script only supports Windows."
}

$registryPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sshd.exe"
$valueName = "MitigationOptions"
$backupValueName = "MitigationOptionsChezmoiBackup"
$serviceName = "sshd"

function Get-RegistryBytes {
    param([string]$Name)

    try {
        return [byte[]](Get-ItemPropertyValue -LiteralPath $registryPath -Name $Name -ErrorAction Stop)
    }
    catch [System.Management.Automation.PSArgumentException] {
        return $null
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        return $null
    }
}

function Format-RegistryBytes {
    param([byte[]]$Value)

    if ($null -eq $Value) {
        return $null
    }

    return [BitConverter]::ToString($Value)
}

function Test-ByteArrayEqual {
    param(
        [byte[]]$Left,
        [byte[]]$Right
    )

    if ($null -eq $Left -or $null -eq $Right -or $Left.Length -ne $Right.Length) {
        return $false
    }

    return -not (Compare-Object -ReferenceObject $Left -DifferenceObject $Right -SyncWindow 0)
}

function Get-RedirectionGuardDisabledValue {
    param([byte[]]$Value)

    if ($null -eq $Value -or $Value.Length -le 18) {
        throw "MitigationOptions is too short to contain the RedirectionGuard flag."
    }

    [byte[]]$disabled = $Value.Clone()
    $disabled[18] = $disabled[18] -band 0xEF
    return $disabled
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Status {
    $current = Get-RegistryBytes -Name $valueName
    $backup = Get-RegistryBytes -Name $backupValueName
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    $guardEnabled = $null -ne $current -and $current.Length -gt 18 -and ($current[18] -band 0x10) -ne 0

    [pscustomobject]@{
        action = $Action
        redirectionGuardEnabled = $guardEnabled
        mitigationOptions = Format-RegistryBytes -Value $current
        backup = Format-RegistryBytes -Value $backup
        serviceState = $service.Status
        restartRequested = [bool]$RestartService
    }
}

if ($Action -eq "Status") {
    Get-Status
    return
}

if (-not (Test-IsAdministrator) -and -not $WhatIfPreference) {
    throw "Run this action from an elevated PowerShell session."
}

$current = Get-RegistryBytes -Name $valueName
$backup = Get-RegistryBytes -Name $backupValueName

if ($Action -eq "Disable") {
    if ($null -eq $current -and $null -eq $backup) {
        throw "Neither $valueName nor its backup exists; refusing to create an ambiguous restore point."
    }

    [byte[]]$source = if ($null -ne $backup) { $backup } else { $current }
    [byte[]]$disabled = Get-RedirectionGuardDisabledValue -Value $source

    if (
        $null -ne $current -and
        $null -ne $backup -and
        -not (Test-ByteArrayEqual -Left $current -Right $backup) -and
        -not (Test-ByteArrayEqual -Left $current -Right $disabled)
    ) {
        throw "$valueName differs from both the saved and disabled values; refusing to overwrite it."
    }

    if ($null -ne $current -and $null -eq $backup) {
        if ($PSCmdlet.ShouldProcess("$registryPath\$backupValueName", "Save the current $valueName value")) {
            New-ItemProperty -LiteralPath $registryPath -Name $backupValueName -PropertyType Binary -Value $current | Out-Null
        }
    }

    if ($null -eq $current -or -not (Test-ByteArrayEqual -Left $current -Right $disabled)) {
        if ($PSCmdlet.ShouldProcess("$registryPath\$valueName", "Clear only the sshd RedirectionGuard mitigation bit")) {
            if ($null -eq $current) {
                New-ItemProperty -LiteralPath $registryPath -Name $valueName -PropertyType Binary -Value $disabled | Out-Null
            }
            else {
                Set-ItemProperty -LiteralPath $registryPath -Name $valueName -Value $disabled
            }
        }
    }
}
else {
    if ($null -eq $backup) {
        throw "The saved $backupValueName value does not exist; refusing to guess the original configuration."
    }

    [byte[]]$disabled = Get-RedirectionGuardDisabledValue -Value $backup

    if (
        $null -ne $current -and
        -not (Test-ByteArrayEqual -Left $current -Right $backup) -and
        -not (Test-ByteArrayEqual -Left $current -Right $disabled)
    ) {
        throw "$valueName differs from both the saved and disabled values; refusing to overwrite it."
    }

    if ($null -eq $current -or -not (Test-ByteArrayEqual -Left $current -Right $backup)) {
        if ($PSCmdlet.ShouldProcess("$registryPath\$valueName", "Restore the saved sshd mitigation options")) {
            if ($null -eq $current) {
                New-ItemProperty -LiteralPath $registryPath -Name $valueName -PropertyType Binary -Value $backup | Out-Null
            }
            else {
                Set-ItemProperty -LiteralPath $registryPath -Name $valueName -Value $backup
            }
        }
    }
}

if ($RestartService) {
    if ($PSCmdlet.ShouldProcess($serviceName, "Restart the OpenSSH server; active SSH sessions will disconnect")) {
        Restart-Service -Name $serviceName -Force
    }
}

Get-Status
