<#
.SYNOPSIS
現在のセッションの環境変数を、レジストリから読み直します。

.DESCRIPTION
今ログオンしたら新しいプロセスが受け取る環境変数を Windows に作らせ（CreateEnvironmentBlock）、
現在のプロセスの環境変数に設定します。システムとユーザーの変数、%VAR% の展開、PATH の結合は Windows と同じ規則になります。
Windows が展開しきれずに %VAR% が残る値は、新しいプロセスと同じくそのまま設定します。
PSModulePath は PowerShell が起動時に自分のモジュールの場所を加えて作るため、読み直しません。
レジストリから削除された変数は、現在のプロセスからは削除しません（親プロセスが設定した変数を残すため）。
Chocolatey の RefreshEnv.cmd を PowerShell で置き換えるものです。
#>
#Requires -Version 7.0

Import-Module (Join-Path $PSScriptRoot 'PathEnv.psm1')

$environment = Get-NewProcessEnvironment
foreach ($name in $environment.Keys) {
    if ($name -eq 'PSModulePath' -or $name.StartsWith('=')) { continue }
    Set-Item -LiteralPath "env:$name" -Value $environment[$name]
}

Write-Host "Environment variables reloaded." -ForegroundColor Green
