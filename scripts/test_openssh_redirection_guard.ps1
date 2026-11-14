#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw (Join-Path $PSScriptRoot 'set-openssh-redirection-guard.ps1')
$base = if ($IsWindows) { Join-Path $env:LOCALAPPDATA 'Temp/pi' } else { '/tmp/pi' }
[IO.Directory]::CreateDirectory($base) | Out-Null
$temp = Join-Path $base ([guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($temp) | Out-Null
try {
    # Replace only confirmation and platform/privilege checks in the isolated copy.
    # All OS access is shadowed by functions below, and the path is not a registry path.
    $source = $source.Replace('if (-not $IsWindows)', 'if ($false)')
    $source = $source.Replace('if (-not (Test-IsAdministrator) -and -not $WhatIfPreference)', 'if ($false)')
    $source = $source.Replace('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sshd.exe', 'Fake:\sshd.exe')
    $subject = Join-Path $temp 'subject.ps1'
    $normalSubject = Join-Path $temp 'normal.ps1'
    [IO.File]::WriteAllText($normalSubject, $source)
    $source = $source.Replace('$PSCmdlet.ShouldProcess(', '$global:Confirmation.Confirm(')
    [IO.File]::WriteAllText($subject, $source)
    class Confirmation {
        [int]$Calls = 0
        [bool]$RejectFirst = $false
        [bool]$Preview = $false
        [bool] Confirm([string]$Target, [string]$Action) {
            $this.Calls++
            if ($this.Preview) { return $false }
            return -not ($this.RejectFirst -and $this.Calls -eq 1)
        }
    }
    function Get-ItemPropertyValue {
        param($LiteralPath, $Name, $ErrorAction)
        if ($LiteralPath -ne 'Fake:\sshd.exe') { throw 'Unexpected path' }
        $v = if ($Name -eq 'MitigationOptions') { $global:Current } else { $global:Backup }
        if ($null -eq $v) { throw [System.Management.Automation.PSArgumentException]::new('missing') }
        return $v
    }
    function New-ItemProperty {
        param($LiteralPath, $Name, $PropertyType, $Value)
        if ($LiteralPath -ne 'Fake:\sshd.exe') { throw 'Unexpected path' }
        if ($global:FailWrite) { throw 'write failed' }
        $global:Events.Add("new:$Name")
        if ($Name -eq 'MitigationOptions') { $global:Current = [byte[]]$Value.Clone() }
        else { $global:Backup = [byte[]]$Value.Clone() }
    }
    function Set-ItemProperty {
        param($LiteralPath, $Name, $Value)
        if ($LiteralPath -ne 'Fake:\sshd.exe') { throw 'Unexpected path' }
        $global:Events.Add("set:$Name")
        $global:Current = [byte[]]$Value.Clone()
    }
    function Get-Service { param($Name, $ErrorAction) [pscustomobject]@{ Status = 'Running' } }
    function Restart-Service { param($Name, [switch]$Force) $global:Events.Add('restart') }
    function Reset-Fake {
        $global:Current = [byte[]]::new(19); $global:Current[18] = 0x10
        $global:Backup = $null; $global:FailWrite = $false
        $global:Events = [collections.generic.list[string]]::new()
        $global:Confirmation = [Confirmation]::new()
    }
    function Check($condition, $message) { if (-not $condition) { throw $message } }
    Reset-Fake
    $global:Confirmation.RejectFirst = $true
    & $subject -Action Disable -RestartService | Out-Null
    Check ($global:Confirmation.Calls -eq 1 -and $global:Events.Count -eq 0 -and $global:Current[18] -eq 0x10) 'rejection did not stop'
    Reset-Fake
    & $subject -Action Disable -RestartService | Out-Null
    Check (($global:Events -join ',') -eq 'new:MitigationOptionsChezmoiBackup,set:MitigationOptions,restart') 'approval order'
    Check ($global:Backup[18] -eq 0x10 -and $global:Current[18] -eq 0) 'approval values'
    $global:Events.Clear()
    & $subject -Action Disable | Out-Null
    Check ($global:Events.Count -eq 0) 'disable not idempotent'
    & $subject -Action Restore -RestartService | Out-Null
    Check (($global:Events -join ',') -eq 'set:MitigationOptions,restart' -and $global:Current[18] -eq 0x10) 'restore'
    $global:Events.Clear()
    & $subject -Action Restore | Out-Null
    Check ($global:Events.Count -eq 0) 'restore not idempotent'
    Reset-Fake
    $global:FailWrite = $true
    $failed = $false
    try { & $subject -Action Disable -RestartService | Out-Null } catch { $failed = $true }
    Check ($failed -and $global:Events.Count -eq 0 -and $global:Current[18] -eq 0x10) 'write failure'
    Reset-Fake
    $global:Confirmation.Preview = $true
    & $subject -Action Disable -RestartService -WhatIf | Out-Null
    Check ($global:Confirmation.Calls -eq 3 -and $global:Events.Count -eq 0) 'whatif preview'
    Reset-Fake
    & $normalSubject -Action Disable -RestartService -WhatIf | Out-Null
    Check ($global:Events.Count -eq 0 -and $global:Current[18] -eq 0x10) 'native whatif'
    Reset-Fake
    $global:Backup = [byte[]]$global:Current.Clone()
    & $subject -Action Disable | Out-Null
    Check (($global:Events -join ',') -eq 'set:MitigationOptions') 'existing backup'
    Write-Host 'OpenSSH guard tests passed'
}
finally { Remove-Item -LiteralPath $temp -Recurse -Force }
