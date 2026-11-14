<#
.SYNOPSIS
ユーザーまたはマシンの環境変数 PATH に新しいパスを追加します。

.DESCRIPTION
指定したパス ($LiteralPath) を Windows の環境変数 PATH に追加します。-User または -Machine で対象を選びます。
同じ場所（%SystemRoot% などを展開し、大文字小文字と末尾の \ を無視して一致）が既にあれば追加しません。
書き込む PATH は、同じ場所の重複を 1 つにまとめ（% 入りの書き方を優先）、大文字小文字を区別せずに並べ替えたものです。
並べ替えによって、同じ名前のコマンドが別のフォルダーから見つかるようになる場合は、その一覧も表示します。
確認後に PATH を更新します。-Machine には管理者権限が必要です。

.PARAMETER User
ユーザー環境変数 PATH を更新する場合に指定します。

.PARAMETER Machine
マシン環境変数 PATH を更新する場合に指定します。

.PARAMETER LiteralPath
追加したいパスを指定します。省略すると、重複の整理と並べ替えだけを行います。

.EXAMPLE
PS> Add-Path -User "C:\tools\bin"

ユーザーの PATH に "C:\tools\bin" を追加します。

.EXAMPLE
PS> Add-Path -User

ユーザーの PATH の重複をまとめ、並べ替えます。
#>
#Requires -Version 7.0
param(
    [Parameter(Mandatory = $true, ParameterSetName = "User")]
    [switch]$User,
    [Parameter(Mandatory = $true, ParameterSetName = "Machine")]
    [switch]$Machine,
    [Parameter(Position = 0, ValueFromPipeline = $true, ParameterSetName = "User")]
    [Parameter(Position = 0, ValueFromPipeline = $true, ParameterSetName = "Machine")]
    [string]$LiteralPath
)

begin {
    Import-Module (Join-Path $PSScriptRoot 'PathEnv.psm1')
}

process {
    $scope = $PSCmdlet.ParameterSetName
    $current = @(Get-PathEntries -Scope $scope)
    $candidate = $current
    $added = $null
    if ([string]::IsNullOrEmpty($LiteralPath)) {
        Write-Host "No path specified; just sorting..."
    }
    else {
        $location = Get-PathLocationKey $LiteralPath
        if (@($current | Where-Object { (Get-PathLocationKey $_) -eq $location }).Count -gt 0) {
            Write-Host "Already in PATH: $LiteralPath (just sorting...)"
        }
        else {
            $candidate = $current + $LiteralPath
            $added = $LiteralPath
        }
    }

    $new = @(Optimize-PathEntries -Entries $candidate)
    Write-Host "PATH entries will be:"
    foreach ($entry in $new) {
        if ($null -ne $added -and $entry -eq $added) { Write-Host "+ $entry" } else { Write-Host "  $entry" }
    }
    $changes = @(Compare-PathResolution -Before (Get-CombinedPathEntries $scope $current) -After (Get-CombinedPathEntries $scope $new))
    Write-PathResolutionChange -Changes $changes

    Write-Host "Press any key to confirm, or 'q' or Esc to cancel..."
    $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    if ($key.Character -eq 'q' -or $key.VirtualKeyCode -eq 27) {
        Write-Error "Operation cancelled by user."
        exit 1
    }

    Set-PathEntries -Scope $scope -Entries $new
    Write-Host "$scope PATH updated."
}
