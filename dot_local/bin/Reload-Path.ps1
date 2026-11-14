<#
.SYNOPSIS
現在のセッションの PATH を、ユーザーとシステムの環境変数から読み直します。

.DESCRIPTION
今ログオンしたら新しいプロセスが受け取る PATH を Windows に作らせ（CreateEnvironmentBlock）、
現在のプロセスの PATH に設定します。システムとユーザーの PATH の結合と %VAR% の展開は Windows と同じ規則になります。
#>
#Requires -Version 7.0

Import-Module (Join-Path $PSScriptRoot 'PathEnv.psm1')

$env:Path = (Get-NewProcessEnvironment)['Path']

Write-Host "PATH reloaded successfully." -ForegroundColor Green
Write-Host "User PATH entries: $(@(Get-PathEntries -Scope User).Count)"
Write-Host "System PATH entries: $(@(Get-PathEntries -Scope Machine).Count)"
