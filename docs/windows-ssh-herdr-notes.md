# Windows に SSH の鍵認証で入って herdr を使う

## やること

- herdr サーバーはタスクスケジューラーから起動する。
  - `scripts/register-herdr-task.ps1` を実行してタスク `herdr-desktop` を登録する。
  - タスクは `scripts/launch-herdr-server.ps1` を呼び、WMI 経由・`DETACHED_PROCESS` で `herdr server` を起動する。
  - リポジトリの場所を変えたら登録し直す（タスクはスクリプトの絶対パスを持つ）。
- デスクトップに誰かがサインインしている状態にしておく。画面が出なくてもいい。再起動したら一度サインインする。
- サーバーを再起動するときは、herdr の外の SSH 接続で次を実行する。
  - `herdr server stop`
  - `Start-ScheduledTask -TaskName 'herdr-desktop'`
- サーバーがない状態で `herdr --remote` しない。herdr が SSH 経由でサーバーを建て、資格情報が使えない状態になる。
- `herdr --remote` が「restart the remote server now?」と聞いてきたら `N` で答え、上の手順で再起動する。
- `/bin/sh` のエラーを消すには、`C:\bin\sh.exe` に Git の `sh.exe` へのシンボリックリンクを置く。

  ```powershell
  New-Item -ItemType Directory C:\bin -Force
  New-Item -ItemType SymbolicLink -Path C:\bin\sh.exe -Target 'C:\Program Files\Git\bin\sh.exe'
  ```

- サーバーを再起動した直後に Pi の配色が原色っぽくなったら、Pi を再起動する。

## 確かめ方

- ペインで `whoami /groups` を実行し、`NT AUTHORITY\INTERACTIVE` があって `NT AUTHORITY\NETWORK` がない。
- `docker pull hello-world` が通る。
- タスクの最終実行結果が `0`（`Get-ScheduledTaskInfo -TaskName herdr-desktop`）。`64` ならスクリプトのパスが合っていない。

## 理由

- 鍵認証の SSH は S4U ログオンになり、資格情報が付かない。資格情報マネージャーを呼ぶと `A specified logon session does not exist` で失敗する（git push、docker pull）。
- 管理者のデスクトップのログオンは、権限を絞った側とフル権限の側の対になる。フル権限の側では資格情報ストアが同じエラーになったので、タスクは権限を絞った側（`Limited`）で動かす。
- 権限を絞ったサーバーには、同じアカウントの管理者のクライアントからもつなげる（herdr の Windows support の説明）。
- タスクが `herdr server` を直接起動するとコンソールの窓を持ち、herdr が「SSH が切れたら生き残れない」と判断して再起動を勧める。herdr 自身と同じく WMI 経由で切り離して起動すれば窓を持たない。WMI で起動したプロセスは呼び出し側のログオンを引き継ぐ。
- herdr は `herdr --remote` のたびに、接続先で最初に `/bin/sh -s` を試して OS を調べる。SSH の既定のシェルが PowerShell だと見つからずにエラーが表示される。
- サーバーの起動時に Pi が自動再開されると、手元のターミナルのパレットが届く前に Pi が色を問い合わせることがある。herdr は届いていない色を内蔵の既定パレットで答え、Pi はそれで配色を作る。
