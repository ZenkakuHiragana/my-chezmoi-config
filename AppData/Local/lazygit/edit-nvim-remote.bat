@echo off
setlocal

if "%~1"=="" (
  echo Usage: %~nx0 FILE_NAME [LINE_NUMBER]
  exit /b 1
)

set "FILE_NAME=%~1"
set "LINE_NUMBER=%~2"

if defined NVIM (
  rem lazygit を表示している floating terminal を閉じる
  nvim --server "%NVIM%" --remote-send "<C-\><C-n>:q<CR>"

  rem 対象ファイルを開く
  nvim --server "%NVIM%" --remote "%FILE_NAME%"

  rem 行番号が指定されていて、かつ 0 より大きい場合だけ移動
  if not "%LINE_NUMBER%"=="" (
    set /a _line=%LINE_NUMBER% >nul 2>&1
    if not errorlevel 1 (
      if %LINE_NUMBER% GTR 0 (
        nvim --server "%NVIM%" --remote-send ":%LINE_NUMBER%<CR>"
      )
    )
  )
) else (
  rem NVIM が無い場合は新規起動
  if not "%LINE_NUMBER%"=="" (
    set /a _line=%LINE_NUMBER% >nul 2>&1
    if not errorlevel 1 (
      if %LINE_NUMBER% GTR 0 (
        nvim "+%LINE_NUMBER%" "%FILE_NAME%"
        exit /b %errorlevel%
      )
    )
  )

  nvim "%FILE_NAME%"
)

endlocal
