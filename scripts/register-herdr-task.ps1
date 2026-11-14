# launch-herdr-server.ps1 をタスクスケジューラーに登録するスクリプト。
# タスクがなければ作り、あれば定義をこの内容で置き換える。

$action = New-ScheduledTaskAction -Execute 'C:\Program Files\PowerShell\7\pwsh.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -File `"$PSScriptRoot\launch-herdr-server.ps1`""
# デスクトップのログオンのうち、権限を絞った側で動かす（管理者側には資格情報が付かない）
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'herdr-desktop' -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Force

# サーバー再起動コマンドはこれ
# herdr server stop
# Start-ScheduledTask -TaskName 'herdr-desktop'
