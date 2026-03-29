
function script:isInteractiveEnvironment {
	$ps = (Get-WmiObject -Class win32_process -Filter "ProcessID=$PID")
	$opts = -split ($ps.CommandLine -replace '^"?[^"]+"?\s+', '')

	return -not ($opts -contains "-NonInteractive") `
		-or (($opts -contains "-Command") -and ($opts -contains "-NoExit"))
}

# [PowerShell]wingetの結果を変数に代入し出力すると文字化けが発生 - Zenn
# https://zenn.dev/haretokidoki/articles/8946231076f129
function Set-PsOutputEncoding {
    param (
        [System.String]$charcode = 'reset_encoding'
    )

    switch ($charcode) {
        # 文字エンコードをUTF8に設定する
        'utf8' {
            $PSDefaultParameterValues['*:Encoding'] = 'utf8'
            $global:OutputEncoding = [System.Text.Encoding]::UTF8
            [console]::OutputEncoding = [System.Text.Encoding]::UTF8
        }
        # 文字エンコードをShift JIS（SJIS）に設定する
        'sjis' {
            # $PSDefaultParameterValues['*:Encoding'] = 'default'について
            #   この設定はCore以外（5.1以前）の環境でのみShift JISで設定される。
            #   Core環境のデフォルト値は、UTF-8でありUTF-8で設定されてしまう。
            #   また、Shift JISのパラメーターも存在しない為、Core環境でShift JISの設定は不可となる。
            $PSDefaultParameterValues['*:Encoding'] = 'default'
            $global:OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
            [console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
        }
        # 文字エンコードをASCIIに設定する
        'ascii' {
            $PSDefaultParameterValues.Remove('*:Encoding')
            $global:OutputEncoding = [System.Text.Encoding]::ASCII
            [console]::OutputEncoding = [System.Text.Encoding]::ASCII
        }
        # デフォルトパラメータの文字エンコード指定を解除する
        'rm_encoding' {
            $PSDefaultParameterValues.Remove('*:Encoding')
        }
        # 文字エンコード設定を初期状態に戻す
        'reset_encoding' {
            $PSDefaultParameterValues.Remove('*:Encoding')

            if ($PSVersionTable.PSEdition -eq 'Core') {
                # Core の場合
                $global:OutputEncoding = [System.Text.Encoding]::UTF8
                [console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
            }
            else {
                # Core 以外の場合（PowerShell 5.1 以前）
                $global:OutputEncoding = [System.Text.Encoding]::ASCII
                [console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
            }
        }
    }
}

function lk() {
    Set-Location $(walk $args)
}

# Quick tip if your $profile is slow to load : r/PowerShell
# https://www.reddit.com/r/PowerShell/comments/1anffqq/quick_tip_if_your_profile_is_slow_to_load/
$null = Register-EngineEvent -SourceIdentifier 'PowerShell.OnIdle' -MaxTriggerCount 1 -Action {
    Import-Module -Name Microsoft.WinGet.CommandNotFound # PowerToys CommandNotFound module
    Import-Module -Name CompletionPredictor

    # UTF-8にする
    Set-PsOutputEncoding 'utf8'

    if (-not (isInteractiveEnvironment)) {
    	return
    }

    # 重複した履歴を保存しない
    Set-PSReadlineOption -HistoryNoDuplicates

    # exitなどを保存しない
    Set-PSReadlineOption -AddToHistoryHandler {
        param ($command)
        switch -regex ($command) {
            "SKIPHISTORY" {return $false}
            "^[a-z]$" {return $false}
            "exit" {return $false}
        }
        return $true
    }

    # 単語区切り文字の変更
    $WordDelimiters = ";:,.[]{}()/\|^&*-=+'`" !?@#$%&_<>「」（）『』『』［］、，。：；／"
    $WordDelimitersRegex = "[" + $WordDelimiters.replace("[", "\[").replace("]", "\]") + "]"
    Set-PSReadLineOption -WordDelimiters $WordDelimiters

    # 括弧と引用符の入力補完
    # * 文字列選択時：
    #   * 選択範囲を括弧で囲みカーソルを閉じ括弧の後ろに移動させる
    # * 非選択時：
    #   * 開き括弧に対応した閉じ括弧を入力して間にカーソルを移動させる
    #   * 一方の括弧が先に入力されていた場合は対応する括弧のみ入力する
    Set-PSReadLineKeyHandler -Key "(","{","[" `
    -BriefDescription "InsertPairedBraces" `
    -LongDescription "Insert matching braces or wrap selection by matching braces" `
    -ScriptBlock {
        param($key, $arg)
        $openChar = $key.KeyChar
        $closeChar = switch ($openChar) {
            <#case#> "(" { [char]")"; break }
            <#case#> "{" { [char]"}"; break }
            <#case#> "[" { [char]"]"; break }
        }

        $selectionStart = $null
        $selectionLength = $null
        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetSelectionState(
            [ref]$selectionStart, [ref]$selectionLength)
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState(
            [ref]$line, [ref]$cursor)

        if ($selectionStart -ne -1) {
            [Microsoft.PowerShell.PSConsoleReadLine]::Replace(`
                $selectionStart, $selectionLength, `
                $openChar + $line.SubString($selectionStart, $selectionLength) + $closeChar)
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition(`
                $selectionStart + $selectionLength + 2)
            return
        }
        $nOpen = [regex]::Matches($line, [regex]::Escape($openChar)).Count
        $nClose = [regex]::Matches($line, [regex]::Escape($closeChar)).Count
        if (($nOpen -ne $nClose) -or
            (($cursor -lt $line.Length) -and -not ($line[$cursor] -match "$WordDelimitersRegex"))) {
            [Microsoft.PowerShell.PSConsoleReadLine]::Insert($openChar)
        }
        else {
            [Microsoft.PowerShell.PSConsoleReadLine]::Insert($openChar + $closeChar)
            [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($cursor - 1)
        }
    }

    # 余計な閉じ括弧を入力しない
    Set-PSReadLineKeyHandler -Key ")","]","}" `
    -BriefDescription "SmartCloseBraces" `
    -LongDescription "Insert closing brace or skip" `
    -ScriptBlock {
        param($key, $arg)

        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

        if ($line[$cursor] -eq $key.KeyChar) {
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($cursor + 1)
        }
        else {
            [Microsoft.PowerShell.PSConsoleReadLine]::Insert($key.KeyChar)
        }
    }

    # 引用符の設定
    Set-PSReadLineKeyHandler -Key '"',"'" `
    -BriefDescription "smartQuotation" `
    -LongDescription "Put quotation marks and move the cursor between them or put marks around the selection" `
    -ScriptBlock {
        param($key, $arg)
        $mark = $key.KeyChar

        $selectionStart = $null
        $selectionLength = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetSelectionState([ref]$selectionStart, [ref]$selectionLength)
        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

        if ($selectionStart -ne -1) {
            [Microsoft.PowerShell.PSConsoleReadLine]::Replace(`
                $selectionStart, $selectionLength, `
                $mark + $line.SubString($selectionStart, $selectionLength) + $mark)
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition(`
                $selectionStart + $selectionLength + 2)
            return
        }

        if ($line[$cursor] -eq $mark) {
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($cursor + 1)
            return
        }

        $nMark = [regex]::Matches($line, $mark).Count
        if (($nMark % 2 -eq 1) -or
            (($cursor -lt $line.Length) -and -not ($line[$cursor] -match "$WordDelimitersRegex"))) {
            [Microsoft.PowerShell.PSConsoleReadLine]::Insert($mark)
        }
        else {
            [Microsoft.PowerShell.PSConsoleReadLine]::Insert($mark + $mark)
            [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($cursor - 1)
        }
    }

    # 入力補完をリスト表示する
    Set-PSReadLineOption -PredictionViewStyle ListView
    Set-PSReadLineOption -PredictionSource HistoryAndPlugin
}

# chcp 65001
