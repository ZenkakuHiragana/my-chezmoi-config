<#
.SYNOPSIS
ユーザーまたはマシンの環境変数 PATH を見やすく表示します。

.DESCRIPTION
レジストリに保存されている PATH の項目を、保存されている順に 1 行ずつ表示します。
%SystemRoot% などの変数は展開せず、保存されている書き方のまま表示します。
各項目はウィンドウ幅に合わせて折り返します。

.PARAMETER User
ユーザーの環境変数 PATH を表示します。

.PARAMETER Machine
マシン全体の環境変数 PATH を表示します。

.EXAMPLE
PS> Show-Path -User

.EXAMPLE
PS> Show-Path -Machine
#>
#Requires -Version 7.0
param(
    [Parameter(Mandatory = $true, ParameterSetName = "User")]
    [switch]$User,
    [Parameter(Mandatory = $true, ParameterSetName = "Machine")]
    [switch]$Machine
)

Import-Module (Join-Path $PSScriptRoot 'PathEnv.psm1')

$scope = $PSCmdlet.ParameterSetName
Write-Host "Current $scope PATH:"
$maxWidth = $host.UI.RawUI.WindowSize.Width - 2
foreach ($entry in @(Get-PathEntries -Scope $scope)) {
    if ($maxWidth -le 0 -or $entry.Length -le $maxWidth) {
        Write-Host "* $entry"
        continue
    }
    $text = $entry
    $first = $true
    while ($text.Length -gt 0) {
        $length = [Math]::Min($maxWidth, $text.Length)
        $prefix = if ($first) { '* ' } else { '  ' }
        Write-Host "$prefix$($text.Substring(0, $length))"
        $text = $text.Substring($length)
        $first = $false
    }
}
