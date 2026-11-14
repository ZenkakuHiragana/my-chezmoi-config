#Requires -Version 7.0
# dot_local/bin/PathEnv.psm1 と Reload-Path.ps1 / Reload-Env.ps1 の試験。本物の環境変数のキーには書き込まない。
# 書き込みの試験は、モジュールのキーの場所を HKCU\Software 以下の一時キーへ差し替えて行う。
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\dot_local\bin\PathEnv.psm1') -Force
$module = Get-Module PathEnv
$failures = 0
function Check([string]$Name, [scriptblock]$Condition) {
    if (& $Condition) { Write-Host "ok   $Name" } else { Write-Host "FAIL $Name"; $script:failures++ }
}

# 場所の鍵: 展開・末尾の \ ・大文字小文字
Check 'location key ignores case, trailing slash and variables' {
    (Get-PathLocationKey 'C:\WINDOWS\System32\') -eq (Get-PathLocationKey '%SystemRoot%\system32')
}
Check 'drive root and drive-relative are different locations' {
    @(Optimize-PathEntries -Entries @('C:\', 'C:')).Count -eq 2 -and @(Optimize-PathEntries -Entries @('C:\\', 'C:')).Count -eq 2
}
Check 'drive root spellings are the same location' { (Get-PathLocationKey 'C:\\') -eq (Get-PathLocationKey 'C:\') }

# B1: 同じ場所の別表記は % 形 1 行にまとまり、1 行消しても別の場所は残る
$b1 = @(Optimize-PathEntries -Entries @('C:\WINDOWS', 'C:\tools', 'C:\Windows', '%SystemRoot%', '%SystemRoot%\system32', ''))
Check 'B1 merges same location preferring % form and sorts' {
    ($b1 -join ';') -eq '%SystemRoot%;%SystemRoot%\system32;C:\tools'
}
$afterRemove = @(for ($i = 0; $i -lt $b1.Count; $i++) { if ($i -ne 0) { $b1[$i] } })
Check 'B1 removing %SystemRoot% keeps System32' { $afterRemove -contains '%SystemRoot%\system32' }
Check 'empty input stays empty' { @(Optimize-PathEntries -Entries @()).Count -eq 0 }

# B2: 並べ替えで解決先が変わるコマンドを検出する
$base = Join-Path $env:LOCALAPPDATA ('Temp\pi\path-env-' + [guid]::NewGuid())
$a = Join-Path $base 'a'; $b = Join-Path $base 'b'; $c = Join-Path $base 'c'
foreach ($d in $a, $b, $c) { [IO.Directory]::CreateDirectory($d) | Out-Null }
[IO.File]::WriteAllText((Join-Path $a 'tool.exe'), '')
[IO.File]::WriteAllText((Join-Path $b 'tool.exe'), '')
[IO.File]::WriteAllText((Join-Path $c 'other.cmd'), '')
try {
    $before = @($b, $a, $c)
    $after = @(Optimize-PathEntries -Entries @($b, $a))   # C:\...\c を消して並べ替え
    $changes = @(Compare-PathResolution -Before $before -After $after)
    Check 'B2 reports tool and tool.exe moving from b to a' {
        $changes.Count -eq 2 -and
        @($changes | Where-Object { $_.Name -in 'tool', 'tool.exe' -and $_.Before -eq $b -and $_.After -eq $a }).Count -eq 2
    }
    Check 'B2 removed command is not reported as moved' { @($changes | Where-Object Name -eq 'other').Count -eq 0 }
    Check 'unchanged order reports nothing' { @(Compare-PathResolution -Before @($a, $b) -After @($a, $b)).Count -eq 0 }
    # 拡張子違いの同名コマンド: a に tool.cmd があっても、tool.exe の行き先の変化を拾う
    $d = Join-Path $base 'd'
    [IO.Directory]::CreateDirectory($d) | Out-Null
    [IO.File]::WriteAllText((Join-Path $d 'tool.cmd'), '')
    $extChanges = @(Compare-PathResolution -Before @($d, $b, $a) -After @($d, $a, $b))
    Check 'B2 reports tool.exe moving even when tool.cmd shadows bare name' {
        @($extChanges | Where-Object { $_.Name -eq 'tool.exe' -and $_.Before -eq $b -and $_.After -eq $a }).Count -eq 1 -and
        @($extChanges | Where-Object Name -eq 'tool').Count -eq 0
    }
}
finally { Remove-Item -LiteralPath $base -Recurse -Force }

# 書き込みと読み込み: 一時キーで REG_EXPAND_SZ と未展開の往復を確かめる
$testSubKey = 'Software\PathEnvTest-' + [guid]::NewGuid()
$created = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($testSubKey)
$created.Close()
$originalKeys = & $module { $script:EnvironmentKeys.User }
try {
    & $module { param($s) $script:EnvironmentKeys.User = @{ Hive = [Microsoft.Win32.Registry]::CurrentUser; SubKey = $s } } $testSubKey
    Check 'missing Path reads as empty' { @(Get-PathEntries -Scope User).Count -eq 0 }
    Set-PathEntries -Scope User -Entries @('%SystemRoot%\system32', 'C:\tools')
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testSubKey)
    $kind = $key.GetValueKind('Path')
    $raw = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
    $key.Close()
    Check 'Set writes REG_EXPAND_SZ' { $kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString }
    Check 'Set keeps variables unexpanded' { $raw -eq '%SystemRoot%\system32;C:\tools' }
    Check 'Get returns unexpanded entries' { (@(Get-PathEntries -Scope User) -join ';') -eq '%SystemRoot%\system32;C:\tools' }
}
finally {
    & $module { param($k) $script:EnvironmentKeys.User = $k } $originalKeys
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($testSubKey)
}

# B3: キーを開けないときは書く前に例外になり、何も作らない（本物の Machine キーには触れない）
$missingSubKey = 'Software\PathEnvTest-missing-' + [guid]::NewGuid()
try {
    & $module { param($s) $script:EnvironmentKeys.User = @{ Hive = [Microsoft.Win32.Registry]::CurrentUser; SubKey = $s } } $missingSubKey
    $threw = $false
    try { Set-PathEntries -Scope User -Entries @('C:\x') } catch { $threw = $true }
    Check 'B3 write to unopenable key throws' { $threw }
    Check 'B3 nothing created' { $null -eq [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($missingSubKey) }
}
finally { & $module { param($k) $script:EnvironmentKeys.User = $k } $originalKeys }

# Reload-Path / Reload-Env: Windows が新しいプロセスに渡す環境（CreateEnvironmentBlock）をそのまま設定する
$fresh = Get-NewProcessEnvironment
Check 'new process environment has expanded System32 in Path' {
    ($fresh['Path'] -split ';') -contains [Environment]::ExpandEnvironmentVariables('%SystemRoot%\system32')
}
Check 'new process environment has the current user name' { $fresh['USERNAME'] -eq [Environment]::UserName }
# Reload-Env は多くの変数を書き換えるので、プロセスの環境変数を丸ごと保存して最後に戻す。
$savedEnvironment = [Environment]::GetEnvironmentVariables()
try {
    $env:Path = 'C:\bogus'
    & (Join-Path $PSScriptRoot '..\dot_local\bin\Reload-Path.ps1') | Out-Null
    Check 'Reload-Path sets Path from new process environment' { $env:Path -eq $fresh['Path'] }
    Check 'new process environment has PSModulePath (precondition)' { $fresh.ContainsKey('PSModulePath') }
    $env:Path = 'C:\bogus'; $env:TEMP = 'C:\bogus'; $env:PATHENV_PROCESS_ONLY = 'keep'; $env:PSModulePath = 'C:\pathenv-sentinel'
    & (Join-Path $PSScriptRoot '..\dot_local\bin\Reload-Env.ps1') | Out-Null
    Check 'Reload-Env sets Path and TEMP from new process environment' { $env:Path -eq $fresh['Path'] -and $env:TEMP -eq $fresh['TEMP'] }
    Check 'Reload-Env keeps process-only variables' { $env:PATHENV_PROCESS_ONLY -eq 'keep' }
    Check 'Reload-Env keeps PSModulePath' { $env:PSModulePath -eq 'C:\pathenv-sentinel' }
}
finally {
    foreach ($name in @([Environment]::GetEnvironmentVariables().Keys)) {
        if (-not $savedEnvironment.Contains($name)) { Remove-Item -LiteralPath "env:$name" }
    }
    # 変わった値だけ戻す（.NET 8 以前は空文字の設定が削除になるため、触っていない空の変数には手を出さない）。
    foreach ($name in $savedEnvironment.Keys) {
        if ([Environment]::GetEnvironmentVariable($name) -cne $savedEnvironment[$name]) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name])
        }
    }
}

if ($failures -gt 0) { throw "$failures check(s) failed" }
Write-Host 'all checks passed'
