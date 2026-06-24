---
name: context-clarification
description: >
  Use when it is unclear whether a request may proceed to implementation, planning, review, or further investigation because stage, scope, invariants, acceptance criteria, verification, evidence gaps, or user decisions are not yet fixed; not for pure local/public fact gathering, already-bounded implementation, or review-only work with a stable contract. 次段階へ進める条件の判定専用。`Readiness record`、必要時の `Requirement contract`、next capability set を返す。
---

# Context Clarification

依頼を次の作業段階へ進めてよいかを判定する。
必要なら、後続作業者が再解釈せずに進めるための `Requirement contract` を固定する。`Requirement contract` は、この skill が出す `task contract` である。

この skill 自体では実装しない。
この skill 自体では詳細な実行計画を作らない。
この skill 自体では最終レビュー結論を出さない。

## 使う条件

次のいずれかに当てはまる場合に使う。

- 現在の作業段階、または次に進めたい作業段階が未確定
- 診断、選択肢比較、方針決定、実装、レビューが混ざっている
- 4層の文脈不足が結果に影響しうる
- 正本、既存パターン、接続経路、検証方法、受け入れ条件のどれかが未固定
- scope、invariants、acceptance criteria、verification method を後続作業者が決め直しそう
- `task-planning`、`implementation`、`code-review` に渡してよいか判断できない
- `user_decision` と調査で解ける不足が混ざっている

## 使わない条件

次の場合は使わない。

- `tiny-local` で、名指しされた資料を読むだけで答えられる
- 純粋な事実質問で、ワークスペース文脈が正否に効かない
- 主作業が `investigation` または `public-research` そのもので、段階判定や契約固定が不要
- 有効な `Readiness record`、`Requirement contract`、`task contract`、旧形式の requirements file、task file があり、次の skill が明確
- read set、write set、verification が明確で、そのまま `implementation` または `code-review` に進める

## 判断対象

判定では、次を確認する。

- 現在の作業段階
- 次に進めたい作業段階
- 依頼文脈
- ワークスペース文脈
- サブシステム文脈
- 外部基盤文脈
- 次段階で正しいものとして扱う主張
- 主張に必要な前提
- 根拠
- 不足
- 不足の解消方法
- 作業契約として固定すべき条件

## 出力

出力は必ず `Readiness record` から始める。
`next capability set` には、直後に必要な skill を最小十分で書く。順序がある場合は順番も示す。

実装、リファクタ、複数ファイル変更、プロンプト階層変更などで、後続作業者が契約を決め直しそうな場合だけ、続けて `Requirement contract` を作る。

### Readiness record

`Readiness record` は、次段階へ進めるかを判定するための記録である。

含める項目:

- 依頼要約
- 現在の作業段階
- 次に進めたい作業段階
- 4層の文脈状態
- 次段階で正しいものとして扱う主張
- 主張ごとの必要前提、根拠、不足
- 不足が偽なら壊れるもの
- 不足の分類
- 次の行動
- readiness decision
- next capability set

### Requirement contract

`Requirement contract` は、後続作業者が再設計せずに作業へ進むための `task contract` である。
必要な場合だけ作る。

含める項目:

- 目的
- 成果物
- 対象範囲
- 対象外
- 保つ条件
- 制約
- 採用方針
- 受け入れ条件
- 確認方法
- 影響する tests
- 影響する docs
- 残る不明点
- 実装へ渡してよい条件

## 既存資料の binding rules

既存の `Readiness record`、`Requirement contract`、`task contract`、旧形式の requirements file、task file は、次のいずれかで今回の依頼に結び付く場合だけ正本候補として扱う。

- ユーザーが明示している
- `.opencode/work/current-task.md` が指している
- `task_slug` が一致している

さらに次を満たすこと。

- `status` が `superseded` ではない
- `base_commit` が現リポジトリ状態に有効
- `superseded_by` が `none` または未設定

満たさない場合は参考資料として扱う。
再利用できる資料があっても、今回の段階遷移に必要な項目が欠けるなら `Readiness record` は作り直す。

## 文脈状態

4層の文脈は次のいずれかに分類する。

- `confirmed`: 今回の判断に必要な項目が根拠付きで埋まっている
- `not_needed`: 今回の判断に関係しない理由を説明できる
- `missing`: 関係する可能性があるが、まだ確認できていない
- `blocked`: 不足が結果、範囲、正本、検証方法、またはユーザー判断に影響するため次段階へ進めない

## 不足の分類

不足は次のいずれかに分類する。

- `user_decision`: 目的、成功条件、対象範囲、見た目、互換性、破壊的変更、採用方針など、ユーザー判断が必要
- `repo_derivable`: リポジトリ内の資料、既存実装、テスト、ログで解ける
- `subsystem_derivable`: 変更対象の主要ファイル、接続経路、呼び出し元、既存パターン、検証方法を読めば解ける
- `public_fact`: 外部基盤、公開仕様、一次情報で解ける
- `contract_gap`: 文脈は概ね分かっているが、scope、invariants、acceptance criteria、verification method が契約として固定されていない
- `implementation_discretion`: 低リスク、局所的、可逆で、既存パターンに従えば決められる

## readiness decision

`Readiness record` には、次のいずれかを必ず書く。

- `pass`: 既存の依頼または契約だけで次段階へ進める
- `pass_with_assumption`: 残る不足が `implementation_discretion`、または低リスクで可逆な仮定だけであり、仮定を明示すれば進められる
- `need_investigation`: blocking な `repo_derivable` または `subsystem_derivable` がある
- `need_public_research`: blocking な `public_fact` がある
- `need_user_decision`: blocking な `user_decision` がある
- `need_requirement_contract`: 事実と方針は概ねそろったが、scope、invariants、acceptance criteria、verification method を契約として固定する必要がある
- `reframe_or_block`: 問題設定、作業段階、成功条件、または依頼単位が合っていないため、そのままでは進めない

複数の不足がある場合は、最初に解くべきものを `readiness decision` にし、残りは不足欄と `next capability set` に列挙する。

## handoff

- `need_investigation`: `investigation`
- `need_public_research`: `public-research`
- `need_user_decision`: ユーザーへの質問、または 1 つの回答が複数の設計判断を動かす場合だけ `grill-me`
- `need_requirement_contract`: この skill 内で `Requirement contract` を作る
- `pass` または `pass_with_assumption` で順序設計や durable な task file が必要: `task-planning`
- `pass` または `pass_with_assumption` で 1 回のまとまった変更として進められる: `implementation`
- `pass` または `pass_with_assumption` で、対象が既に bounded な diff、PR、コード面の確認である: `code-review`
- `reframe_or_block`: 実装せず、診断、設計相談、または依頼の切り分けへ戻す

## 禁止

- 調査で解ける不足を、先にユーザー質問にしない
- `user_decision` に属する不足を、`implementation_discretion` にしない
- 一般論だけでワークスペース固有の正本を決めない
- 読んでいない資料を根拠にしない
- 必要な層が `missing` または `blocked` のまま、実装、レビュー結論、断定的な提案へ進まない
- `contract_gap` が残るのに `task-planning`、`implementation`、`code-review` に渡さない
- 有効な既存契約で足りる作業まで、惰性的にこの skill を通さない

## 完了条件

- 現在の作業段階と次に進めたい作業段階を分けた
- 4層の文脈状態を確認した
- 次段階で正しいものとして扱う主張を列挙した
- 主張に根拠または不足を結び付けた
- 不足を分類した
- readiness decision を出した
- 必要なら `Requirement contract` を作った
- 既存資料を使う場合は binding rules を確認した
- 次の capability set を示した
- 不足が結果に影響する状態で `implementation`、`task-planning`、`code-review` に渡していない
