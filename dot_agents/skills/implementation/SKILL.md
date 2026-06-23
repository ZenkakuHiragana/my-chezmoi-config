---
name: implementation
description: Use when the repository change, invariants, acceptance criteria, verification method, and affected tests/docs are already fixed well enough to execute; not for fact finding, unsettled requirements, or review-only work. 実装専用。必要な関連面の更新と検証まで完了させる。
---

# Implementation

リポジトリ内容を変更し、依頼、周辺面、検証がそろった状態まで進める。
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

1. 期待する結果、完了条件、変更分類を確認する。
2. 関連面を読む。
3. まとまった最小差分を作る。
4. 変更したファイルと依存する関連面を再読する。
5. acceptance criteria に直結する確認を実行する。
6. 元の依頼、集めた事実、変更した成果物、実行した確認を照合する。

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
- 依存する関連面を確認した。
- 変更したファイルを再読した。
- 必須の確認を試した。
- 古い規範文が残っていない。
- 不要な互換層を入れていない。
- 部分編集を完了と呼んでいない。
