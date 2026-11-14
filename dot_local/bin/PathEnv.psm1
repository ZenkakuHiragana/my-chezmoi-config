#Requires -Version 7.0
# Add-Path / Remove-Path / Show-Path / Reload-Path / Reload-Env が共有する、
# レジストリの環境変数 Path の読み書きと整理の規則。
#
# - 読むときは %SystemRoot% などを展開しない。展開は場所の比較と解決先の計算の中だけで行う。
# - 書くときは REG_EXPAND_SZ で書き、設定変更を通知する。
# - 整理 = 同じ場所の重複を 1 つにまとめ（% 入りの書き方を優先）、大文字小文字を区別せずに並べ替える。

Set-StrictMode -Version Latest

$script:EnvironmentKeys = @{
    User    = @{ Hive = [Microsoft.Win32.Registry]::CurrentUser; SubKey = 'Environment' }
    Machine = @{ Hive = [Microsoft.Win32.Registry]::LocalMachine; SubKey = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment' }
}

function Open-EnvironmentKey([string]$Scope, [bool]$Writable) {
    $location = $script:EnvironmentKeys[$Scope]
    $key = $location.Hive.OpenSubKey($location.SubKey, $Writable)
    if ($null -eq $key) { throw "環境変数のレジストリキーを開けません: $Scope" }
    $key
}

function Send-EnvironmentChange {
    if (-not ('PathEnv.NativeMethods' -as [type])) {
        Add-Type -Namespace PathEnv -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    }
    $result = [UIntPtr]::Zero
    # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG。値は書き終えているので、通知の失敗は無視する。
    [void][PathEnv.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
}

function Get-PathEntries {
    param([Parameter(Mandatory)][ValidateSet('User', 'Machine')][string]$Scope)
    $key = Open-EnvironmentKey $Scope $false
    try {
        $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    }
    finally { $key.Close() }
    $raw -split ';' | Where-Object { $_ -ne '' }
}

function Set-PathEntries {
    param(
        [Parameter(Mandatory)][ValidateSet('User', 'Machine')][string]$Scope,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Entries
    )
    $key = Open-EnvironmentKey $Scope $true
    try {
        $key.SetValue('Path', ($Entries -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    }
    finally { $key.Close() }
    Send-EnvironmentChange
}

function Get-PathLocationKey {
    param([Parameter(Mandatory)][string]$Entry)
    $location = [Environment]::ExpandEnvironmentVariables($Entry)
    $trimmed = $location.TrimEnd('\')
    # ドライブのルート（C:\ や C:\\）は \ を 1 つ残す。C: は別の意味（そのドライブの現在のフォルダー）になる。
    if ($trimmed -match '^[A-Za-z]:$' -and $location.Length -gt $trimmed.Length) { $trimmed += '\' }
    $trimmed.ToLowerInvariant()
}

function Optimize-PathEntries {
    param([Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Entries)
    $byLocation = [ordered]@{}
    foreach ($entry in $Entries) {
        if ([string]::IsNullOrEmpty($entry)) { continue }
        $location = Get-PathLocationKey $entry
        if (-not $byLocation.Contains($location)) {
            $byLocation[$location] = $entry
        }
        elseif ($entry.Contains('%') -and -not $byLocation[$location].Contains('%')) {
            $byLocation[$location] = $entry
        }
    }
    $sorted = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $byLocation.Values) { $sorted.Add($entry) }
    $sorted.Sort([StringComparer]::OrdinalIgnoreCase)
    $sorted.ToArray()
}

function Get-PathResolution {
    param([Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Entries)
    $extensions = @(($env:PATHEXT -split ';') + '.PS1' | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() })
    $resolution = @{}
    foreach ($entry in $Entries) {
        $directory = [Environment]::ExpandEnvironmentVariables($entry)
        if (-not [System.IO.Directory]::Exists($directory)) { continue }
        try { $files = [System.IO.Directory]::GetFiles($directory) } catch { continue }
        foreach ($file in $files) {
            if ($extensions -notcontains [System.IO.Path]::GetExtension($file).ToLowerInvariant()) { continue }
            # 名前だけ（tool）と拡張子付き（tool.exe）の両方で呼ばれうるので、両方を記録する。
            foreach ($name in [System.IO.Path]::GetFileNameWithoutExtension($file), [System.IO.Path]::GetFileName($file)) {
                $name = $name.ToLowerInvariant()
                if (-not $resolution.ContainsKey($name)) { $resolution[$name] = $entry }
            }
        }
    }
    $resolution
}

function Compare-PathResolution {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Before,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$After
    )
    $old = Get-PathResolution -Entries $Before
    $new = Get-PathResolution -Entries $After
    foreach ($name in ($old.Keys | Sort-Object)) {
        if (-not $new.ContainsKey($name)) { continue }
        if ((Get-PathLocationKey $old[$name]) -ne (Get-PathLocationKey $new[$name])) {
            [pscustomobject]@{ Name = $name; Before = $old[$name]; After = $new[$name] }
        }
    }
}

function Get-CombinedPathEntries {
    param(
        [Parameter(Mandatory)][ValidateSet('User', 'Machine')][string]$Scope,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$ScopeEntries
    )
    # コマンドの検索順は Machine の項目、続いて User の項目。
    if ($Scope -eq 'Machine') { @($ScopeEntries) + @(Get-PathEntries -Scope User) }
    else { @(Get-PathEntries -Scope Machine) + @($ScopeEntries) }
}

function Write-PathResolutionChange {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Changes)
    if ($Changes.Count -eq 0) { return }
    Write-Host "Commands that will resolve to a different directory:" -ForegroundColor Yellow
    foreach ($change in $Changes) {
        Write-Host ("  {0}: {1} -> {2}" -f $change.Name, $change.Before, $change.After)
    }
}

# 今ログオンしたら新しいプロセスが受け取る環境変数（名前 -> 値）。
# 展開の順序、Path の結合、USERNAME などの扱いは Windows（CreateEnvironmentBlock）に任せる。
function Get-NewProcessEnvironment {
    if (-not ('PathEnv.UserEnv' -as [type])) {
        Add-Type -Namespace PathEnv -Name UserEnv -MemberDefinition @'
[DllImport("userenv.dll", SetLastError = true)]
public static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);
[DllImport("userenv.dll", SetLastError = true)]
public static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);
'@
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $block = [IntPtr]::Zero
    try {
        if (-not [PathEnv.UserEnv]::CreateEnvironmentBlock([ref]$block, $identity.Token, $false)) {
            throw [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
        }
        $values = @{}
        $offset = 0
        while ($true) {
            $line = [Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]::Add($block, $offset))
            if ([string]::IsNullOrEmpty($line)) { break }
            $offset += ($line.Length + 1) * 2
            $separator = $line.IndexOf('=', 1)   # =C: のように = で始まる名前がある
            if ($separator -gt 0) { $values[$line.Substring(0, $separator)] = $line.Substring($separator + 1) }
        }
        $values
    }
    finally {
        if ($block -ne [IntPtr]::Zero) { [void][PathEnv.UserEnv]::DestroyEnvironmentBlock($block) }
        $identity.Dispose()
    }
}

Export-ModuleMember -Function Get-PathEntries, Set-PathEntries, Get-PathLocationKey, Optimize-PathEntries,
    Get-PathResolution, Compare-PathResolution, Get-CombinedPathEntries, Write-PathResolutionChange,
    Get-NewProcessEnvironment
