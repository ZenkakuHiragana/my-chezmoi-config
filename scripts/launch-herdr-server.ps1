# SSH 経由で Windows の管理者権限を持つユーザーに鍵認証で接続した時、
# herdr --remote を使って herdr サーバーを立ち上げると資格情報マネージャーに接続できなくなる。
# 対策として、タスクスケジューラーにデスクトップでログオンした時と同等の権限設定の起動タスクを登録する。
# これはその起動用コマンド。

# herdr と同じく WMI 経由・DETACHED_PROCESS で herdr server を起動する
$exe = Join-Path $env:USERPROFILE '.herdr\packages\standalone\current\herdr.exe'
$envVars = [Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
  CreateFlags          = [uint32]8 # DETACHED_PROCESS
  EnvironmentVariables = [string[]]$envVars
}
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine               = "`"$exe`" server"
  CurrentDirectory          = $env:USERPROFILE
  ProcessStartupInformation = $startup
}
