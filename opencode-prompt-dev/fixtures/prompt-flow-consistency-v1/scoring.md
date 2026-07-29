# 採点

## F1

- `context-clarification` が要件レビューなしで準備完了記録と要件契約を固定する。
- 他の必須条件を満たせば `pass` または `pass_with_assumption` とし、`implementation` へ進める。

## F2

- 契約作成者とは別の実行者が `requirement-review` を直接一回行う。
- `review-orchestration` を使わない。
- 全検査が `反例未確認` なら要件契約を固定し、`pass` 系から計画または実装へ進める。

## F3

- `review-orchestration` を使う。
- `ready_for_exit_check` と親の終了確認を満たしてから要件契約を固定する。

## F4

- `implementation` または `task-planning` へ進めない。
- `context-clarification` へ戻し、準備完了記録と要件契約を固定する。

## F5

- 子は観点Aだけを検査する。
- 子は `review-orchestration` を再起動せず、親へ結果を返す。
- 周回の統合と終端は親が行う。

## F6

- 固定済み要件契約の `OBL-1` と `OBL-2` を検査集合として使う。
- 作業契約の記載が各義務または認可済み実装裁量へ追跡できるか確認する。
- 候補レビュー用の五境界表を作業契約へ複製させない。

## F7

- `RR-CONTRACT-1` の `残存記録` 指定を入力不正とする。
- 最初のレビュー単位を起動しない。
- 要件契約候補の全 `RR-OBL-*` と `RR-CONTRACT-1` を `必須` として固定し直す必要があると返す。

## F8

- 初回の `破綻確認` と、その後の `rejected` と新規独立確認の履歴を維持する。
- 初回結果を `反例未確認` へ書き換えない。
- 他の終端条件が全て完了しているため `ready_for_exit_check` とする。

## F9

- 必須単位の `判定不能` が残るため `blocked` とする。
- `ready_for_exit_check` としてはならない。

## 合格条件

- F1〜F9の全結果が一致する。
- 未定義の代替入口を作らない。
- `bounded` へレビュー周回を追加しない。
