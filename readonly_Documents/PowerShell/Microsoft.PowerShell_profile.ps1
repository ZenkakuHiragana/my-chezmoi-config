function Set-PsOutputEncoding {
    param (
        [string]$CharCode = 'reset_encoding'
    )

    switch ($CharCode) {
        'utf8' {
            $PSDefaultParameterValues['*:Encoding'] = 'utf8'
            $global:OutputEncoding = [System.Text.Encoding]::UTF8
            [console]::OutputEncoding = [System.Text.Encoding]::UTF8
        }
        'sjis' {
            $PSDefaultParameterValues['*:Encoding'] = 'default'
            $global:OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
            [console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
        }
        'ascii' {
            $PSDefaultParameterValues.Remove('*:Encoding')
            $global:OutputEncoding = [System.Text.Encoding]::ASCII
            [console]::OutputEncoding = [System.Text.Encoding]::ASCII
        }
        'rm_encoding' {
            $PSDefaultParameterValues.Remove('*:Encoding')
        }
        'reset_encoding' {
            $PSDefaultParameterValues.Remove('*:Encoding')

            if ($PSVersionTable.PSEdition -eq 'Core') {
                $global:OutputEncoding = [System.Text.Encoding]::UTF8
                [console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
            }
            else {
                $global:OutputEncoding = [System.Text.Encoding]::ASCII
                [console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('shift_jis')
            }
        }
    }
}

function Test-InteractiveShell {
    if ($null -ne $script:IsInteractiveShell) {
        return $script:IsInteractiveShell
    }

    $cmdLineArgs = [Environment]::GetCommandLineArgs()
    $normalizedArgs = @($cmdLineArgs | ForEach-Object { $_.ToLowerInvariant() })

    $script:IsInteractiveShell =
        [Environment]::UserInteractive -and
        $Host.Name -ne 'ServerRemoteHost' -and
        -not [Console]::IsInputRedirected -and
        -not [Console]::IsOutputRedirected -and
        -not ($normalizedArgs -contains '-noninteractive') -and
        -not ($normalizedArgs -contains '-file') -and
        -not ($normalizedArgs -contains '-command')

    return $script:IsInteractiveShell
}

if ($PSVersionTable.PSEdition -eq 'Core') {
    Set-PsOutputEncoding 'utf8'
}

if (Test-InteractiveShell) {
    Set-PSReadlineOption -HistoryNoDuplicates
    Set-PSReadlineOption -AddToHistoryHandler {
        param ($command)

        switch -regex ($command) {
            'SKIPHISTORY' { return $false }
            '^[a-z]$' { return $false }
            'exit' { return $false }
        }

        return $true
    }

    $WordDelimiters = ";:,.[]{}()/\|^&*-=+'`" !?@#$%&_<>「」（）『』『』［］、，。：；／"
    Set-PSReadlineOption -WordDelimiters $WordDelimiters
    Set-PSReadlineOption -PredictionViewStyle ListView
    Set-PSReadlineOption -PredictionSource HistoryAndPlugin
}

function lk() {
    Set-Location $(walk $args)
}

if (Test-InteractiveShell) {
    $script:DeferredProfile = {
        Import-Module -Name Microsoft.WinGet.CommandNotFound -ErrorAction SilentlyContinue
        Import-Module -Name CompletionPredictor -ErrorAction SilentlyContinue
    }

    $script:DeferredProfileState = [psmoduleinfo]::new($false)
    $script:DeferredProfileState.SessionState = $ExecutionContext.SessionState

    $script:DeferredProfileRunspace = [runspacefactory]::CreateRunspace($Host)
    $script:DeferredProfileRunspace.Open()
    $script:DeferredProfileRunspace.SessionStateProxy.SetVariable('GlobalState', $script:DeferredProfileState)
    $script:DeferredProfileRunspace.SessionStateProxy.SetVariable('DeferredProfile', $script:DeferredProfile)

    $script:DeferredProfilePowerShell = [powershell]::Create()
    $script:DeferredProfilePowerShell.Runspace = $script:DeferredProfileRunspace

    $null = $script:DeferredProfilePowerShell.AddScript({
        Start-Sleep -Milliseconds 200
        do { Start-Sleep -Milliseconds 200 } until (Get-Command Import-Module -ErrorAction Ignore)

        . $GlobalState {
            . $DeferredProfile
        }
    }.ToString()).BeginInvoke()
}
