---
name: implementation
description: Use when `Readiness record` is `pass` or `pass_with_assumption`, or when a fixed `Requirement contract` / other `task contract` already covers the repository change, invariants, acceptance criteria, verification method, and affected tests/docs; not for fact finding, contract shaping, or review-only work. 実装専用。必要な関連面の更新と検証まで完了させる。
---

# Implementation

リポジトリ内容を変更し、依頼、周辺面、検証がそろった状態まで進める。
`Readiness record` が `pass` / `pass_with_assumption`、または `Requirement contract` を含む同等の `task contract` が固定済みであることを前提にする。ここが崩れるなら `context-clarification` に戻す。
単発編集ではなく、task contract の完了を扱う。

## 変更分類

編集前に分類する。

- `new_feature`: 入口、接続、文書、テストを重視
- `modify_existing`: 既存契約、呼び出し元、互換性、古い文書を重視
- `bugfix`: 影響を受ける経路、退行リスク、意図された挙動の維持を重視

## 読むもの

最低限:

- 対象ファイル
- 近くの呼び出し元や利用側
- 関連する schema/type/config
- 挙動を定義するテスト / 文書

## 編集原則

- task contract の acceptance criteria を満たす、まとまった最小変更にする。
- 公開 interface、config の key、prompt contract、文書化された workflow を変えたら依存する関連面も確認する。
- 規範的な成果物には現在有効な内容を直接書く。旧状態の墓標を残さない。
- 代替経路、機能フラグ、互換用の薄い補助層、移行経路、警告抑制は要求または既存 contract がある場合だけ追加する。
- 無関係なユーザー変更は戻さない。

## 手順

1. 期待する結果、完了条件、固定済み契約、変更分類を確認する。
2. 関連面を読む。
3. まとまった最小差分を作る。
4. 変更したファイルと依存する関連面を再読する。
5. acceptance criteria に直結する確認を実行する。
6. 元の依頼、集めた事実、変更した成果物、実行した確認を照合する。
7. `work_class` が `broad-or-unclear` のときは、完了前に別実行者による `code-review` を必須にする。自作の自己レビューでは代替しない。

## 検証

優先順:

1. 変更したファイルの再読
2. 関連する診断 / 型検査 / lint
3. 対象テスト
4. より広い確認

実行できない場合は理由を明示する。

## 返す内容

- 変更したファイル
- 挙動、文書、config の変更有無
- 実行した確認と具体的な結果
- 本当に残る場合だけ未解決の制限

## 完了チェック

- request と task contract を満たした。
- 固定済み契約を勝手に組み替えていない。
- 依存する関連面を確認した。
- 変更したファイルを再読した。
- 必須の確認を試した。
- 古い規範文が残っていない。
- 不要な互換層を入れていない。
- 部分編集を完了と呼んでいない。
- 変更後、差分に新しく現れた外部 API、リポジトリ内接続、識別子、パラメータ、パスを列挙し、
  4つの文脈層へ分類し正当性を検証する。生成した差分の全てが正当であると主張できるだけの根拠を提示する。
- `broad-or-unclear` では、変更対象に対応する別実行者 review を通した。
  code / diff / 実装面は `code-review`、再利用される日本語文章は `japanese-doc-review` を使う。
  両方を変更した場合は両方を通す。一方を他方の代替にしてはならない。
