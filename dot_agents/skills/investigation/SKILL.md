---
name: investigation
description: >
  Use when a claim, fix, review finding, or implementation decision depends on unread repository-local files, configs, logs, generated artifacts, runtime traces, or other local source-of-truth evidence; not for pure public facts or already-ready implementation. ローカル根拠の確認専用。観測事実、未解決点、次の行動を返す。
---

# Investigation

リポジトリ内の正本を確認してから、説明、修正方針、レビュー指摘、実装方針を決める。
`repo_derivable` な要求属性を、観測した根拠で解決する。

## 確認する根拠

- 現在のリポジトリ
- ローカルの upstream checkout
- 生成済みグラフ
- 実行時の成果物
- log、trace、state
- AGENTS.md、domain notes、ユーザーが名指しした authoritative path

## 手順

1. 観測対象、期待挙動、不明点を短く言い直す。
2. 名指しされた正本を最初に読む。
3. 可能なら再現または近い確認を行う。
4. 関連ファイル、呼び出し元、configs、tests、logs、outputs を範囲を絞って確認する。
5. 必要な根拠種別が複数ある場合は、どこまで確認したかを表で管理する。
6. 仮説を根拠で比較し、除外できるものを除外する。
7. ローカル根拠だけで足りない外部 issue/docs は `public-research` へ渡す。
8. temporary diagnostics は狭く入れ、最後に除去する。残す場合は明示する。
9. 確認済みの観測、残る不明点、next capability set を返す。

## 返す内容

- 事実確認の問い、または観測された挙動
- 確認済みの観測と根拠
- 解決した `repo_derivable` fields
- 再現状況
- 絞り込んだ範囲
- 除外した項目
- 根拠順に並べた有力な説明
- 残る不明点
- 推奨する次の行動
- temporary diagnostics の状態

## 完了チェック

- 必要なローカル根拠種別を確認した。
- 未確認の根拠種別を確定した主張に使っていない。
- 検索範囲を repo または明示 directory に限定した。
- user constraints を維持した。
- 根拠と推測を分けた。
- next action が最小十分。
