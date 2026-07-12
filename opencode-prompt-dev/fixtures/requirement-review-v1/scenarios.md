# Scenarios

## S1 明示要求の欠落

依頼:

- WindowsとLinuxで同じcommandを生成する。
- 既存設定を変更しない。

契約:

- 達成結果: Windows用commandを生成する。
- scope: generatorだけを変更する。
- acceptance criteria: Windowsで生成結果を実行できる。
- verification method: Windowsで生成と実行を確認する。

## S2 無認可条項

依頼:

- JSONの重複IDを報告する。

契約:

- 達成結果: 重複IDを報告する。
- scope: report scriptだけを変更する。
- invariants: 実行時間を100ms未満にする。
- acceptance criteria: 重複ID一覧が入力と一致する。
- verification method: 既知入力と出力を照合する。

## S3 実装詳細の複製

依頼:

- ユーザー発話を持つ親session数を月別に出力する。

契約:

- 達成結果: 月別件数を出力する。
- acceptance criteria: fixtureの期待件数と一致する。
- verification method: testを実行する。
- 条項: SQLは`message.session_id = session.id`で結合し、`json_extract(message.data, '$.role') = 'user'`を使う。

既存所有先:

- SQLとDB列は集計scriptとそのtestが所有する。

## S4 clean

依頼:

- 入力Markdownから見出し一覧をJSONへ出力する。
- 入力fileは変更しない。

契約:

- 達成結果: 見出し一覧をJSONへ出力する。
- scope: converterとtestを変更する。入力Markdownは変更しない。
- invariants: 入力fileのhashを実行前後で維持する。
- acceptance criteria: fixtureの見出し順と出力順が一致する。
- verification method: fixture testと入力hash比較を実行する。

既存所有先:

- converterがMarkdown見出しを出現順にJSONへ変換する。
- 既存fixture testが見出し順を検査する。
- 今回の変更はconverterとtestに閉じる。
