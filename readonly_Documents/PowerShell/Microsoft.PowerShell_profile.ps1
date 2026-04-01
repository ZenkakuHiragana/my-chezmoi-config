
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

    # 入力補完をリスト表示する
    Set-PSReadLineOption -PredictionViewStyle ListView
    Set-PSReadLineOption -PredictionSource HistoryAndPlugin
}

# chcp 65001
