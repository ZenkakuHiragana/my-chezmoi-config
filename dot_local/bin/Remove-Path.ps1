<#
.SYNOPSIS
ユーザーまたはマシンの環境変数 PATH から、選んだ項目を削除します。

.DESCRIPTION
PATH の項目をチェックボックス付きの一覧で表示し、選んだ項目を削除します。
一覧には、同じ場所（%SystemRoot% などを展開し、大文字小文字と末尾の \ を無視して一致）の重複を 1 つにまとめ
（% 入りの書き方を優先）、大文字小文字を区別せずに並べ替えた項目を表示します。書き込まれるのは、この一覧から選んだ行を除いたものです。
同じ名前のコマンドが別のフォルダーから見つかるようになる場合は、その一覧を表示して確認します。
-Machine には管理者権限が必要です。

.PARAMETER User
ユーザー環境変数 PATH から削除する場合に指定します。

.PARAMETER Machine
マシン環境変数 PATH から削除する場合に指定します。

.PARAMETER LiteralPath
最初から選択しておくパスを指定します。同じ場所の項目が選択されます。

.EXAMPLE
PS> Remove-Path -User 'C:\tools\Sample'

一覧で 'C:\tools\Sample' を選択した状態から始めます。
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

    # 選ばれた行の位置（0 始まり）を返す。中止したときは何も返さない。
    function Show-Selector {
        param(
            [string[]]$Items,
            [bool[]]$Preselected
        )
        $selected = [bool[]]$Preselected.Clone()
        $cursor = 0
        $done = $false

        function Render {
            Clear-Host
            $windowWidth = $host.UI.RawUI.WindowSize.Width
            $navigations = @(
                "[Up/Down] Navigate",
                "[Space] Toggle",
                "[Enter] Confirm",
                "[Q/ESC] Cancel"
            )
            $navigationLengthSum = ($navigations | ForEach-Object { $_.Length } | Measure-Object -Sum).Sum
            $navigationSpaces = ($windowWidth - $navigationLengthSum) / $navigations.Count
            Write-Host ($navigations -join (' ' * [Math]::Max(1, [int]$navigationSpaces)))
            # Paging support: Show only what's visible in terminal height
            $windowHeight = $host.UI.RawUI.WindowSize.Height
            $maxVisible = $windowHeight - 3  # Reserve lines for prompt/instructions
            if ($Items.Count -gt $maxVisible) {
                $start = [Math]::Max(0, $cursor - [int]($maxVisible / 2 - 0.5))
                if ($start + $maxVisible -gt $Items.Count) {
                    $start = $Items.Count - $maxVisible
                }
                $end = $start + $maxVisible - 1
            }
            else {
                $start = 0
                $end = $Items.Count - 1
            }
            for ($i = $start; $i -le $end; $i++) {
                $check = if ($selected[$i]) { "[x]" } else { "[ ]" }
                $pointer = if ($i -eq $cursor) { ">" } else { " " }
                $text = $Items[$i]
                $maxTextWidth = $windowWidth - 6 # account for "> [x] " or "  [ ] " prefix
                $first = $true
                do {
                    $length = if ($maxTextWidth -gt 0) { [Math]::Min($maxTextWidth, $text.Length) } else { $text.Length }
                    if ($first) { Write-Host "$pointer $check $($text.Substring(0, $length))" }
                    else { Write-Host "      $($text.Substring(0, $length))" }
                    $text = $text.Substring($length)
                    $first = $false
                } while ($text.Length -gt 0)
            }
            if ($Items.Count -gt $maxVisible) {
                Write-Host "[Showing $($start+1)-$($end+1) of $($Items.Count)]"
            }
        }

        Render
        while (-not $done) {
            $key = $host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
            switch ($key.VirtualKeyCode) {
                38  { if ($cursor -gt 0) { $cursor-- }; Render }                # Up arrow
                40  { if ($cursor -lt $Items.Count - 1) { $cursor++ }; Render } # Down arrow
                32  { $selected[$cursor] = -not $selected[$cursor]; Render }    # Space bar
                13  { $done = $true }                                           # Enter
                27  { return }                                                  # ESC
                81  { return }                                                  # Q
                113 { return }                                                  # q
            }
        }
        for ($i = 0; $i -lt $Items.Count; $i++) {
            if ($selected[$i]) { $i }
        }
    }
}

process {
    $scope = $PSCmdlet.ParameterSetName
    $current = @(Get-PathEntries -Scope $scope)
    $items = @(Optimize-PathEntries -Entries $current)
    if ($items.Count -eq 0) {
        Write-Host "$scope PATH is empty."
        return
    }

    $preselected = [bool[]]::new($items.Count)
    if (-not [string]::IsNullOrEmpty($LiteralPath)) {
        $location = Get-PathLocationKey $LiteralPath
        for ($i = 0; $i -lt $items.Count; $i++) {
            $preselected[$i] = (Get-PathLocationKey $items[$i]) -eq $location
        }
    }

    $removed = @(Show-Selector -Items $items -Preselected $preselected)
    if ($removed.Count -eq 0) {
        Write-Host "No entries selected. Exiting."
        return
    }

    $new = @(for ($i = 0; $i -lt $items.Count; $i++) { if ($removed -notcontains $i) { $items[$i] } })
    $changes = @(Compare-PathResolution -Before (Get-CombinedPathEntries $scope $current) -After (Get-CombinedPathEntries $scope $new))
    if ($changes.Count -gt 0) {
        Write-PathResolutionChange -Changes $changes
        if ((Read-Host "Continue? (y/N)") -ne 'y') {
            Write-Host "Cancelled."
            return
        }
    }

    Write-Host "Removing..."
    foreach ($i in $removed) { Write-Host "- $($items[$i])" }
    Set-PathEntries -Scope $scope -Entries $new
    Write-Host "$scope PATH updated."
}
