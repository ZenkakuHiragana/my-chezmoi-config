---
name: requirements-clarification
description: >
  Use when an implementation-shaped request still lacks stable scope, invariants, acceptance criteria, verification, affected tests/docs, or decomposition into atomic requirements; not for pure fact questions, pure local investigation, pure public research, or already-executable refactoring. 実装依頼の要件整理専用。atomic requirements、残る調査、質問、次の skill を確定する。
---

# Requirements Clarification

実装に見える依頼を、実行前に `Attribute status` 付き atomic requirement の記録へ落とす。
曖昧さを感覚で処理しない。固定形式の記録、属性 status、残る capability 上の義務で管理する。

## 入力

- 元のユーザー依頼
- 明示された制約、好み、過去の決定
- リポジトリ文脈
- 必要な公開事実

## 出力

- `.opencode/work/req-<slug>.md`
- `Attribute status` 付き atomic requirement records
- 残る `unknown` だけへの絞った質問
- next capability set

## record schema

各 atomic requirement に必ず書く。

- `Type`
- `Normalized statement`
- `Source`
- `Target`
- `Desired change`
- `Invariants`
- `Constraints`
- `Acceptance criteria`
- `Verification method`
- `Affected tests`
- `Affected docs`
- `Attribute status`

`Attribute status` は、各必須属性に 1 つだけ付ける。

- `user_provided`: ユーザー入力で確定
- `repo_derivable`: repo 調査で解決する
- `public_fact`: 公開情報で確認する
- `unknown`: 適切な範囲の調査後もユーザー判断が必要

空欄は禁止。該当なしなら `None identified.` と書く。

## 手順

1. 依頼を 1 文で言い直す。
2. 関連ファイル、文書、テストを読む。
3. 公開事実が必要なら `public-research` を付ける。
4. 要求を capability、constraint、quality の atomic requirements に分割する。
5. 各 atomic requirement を schema に埋め、各属性に `Attribute status` を付ける。
6. `repo_derivable` は `investigation`、`public_fact` は `public-research`、`unknown` は絞った質問へ回す。
7. `.opencode/work/req-<slug>.md` に書く。
8. 最小の next capability set を示す。

## 結び付け

既存 requirements artifact は、候補となる正本として扱う。
正本として使う条件:

- ユーザーが明示
- `.opencode/work/current-task.md` が指す
- `task_slug` が一致

さらに次を満たすこと。

- `status` が `superseded` ではない
- `base_commit` が現リポジトリ状態に有効
- `superseded_by` が `none` または未設定

満たさない場合は参考資料として扱う。

## 引き渡し

- required `repo_derivable` 未解決: `investigation`
- required `public_fact` 未解決: `public-research`
- required `unknown` 未解決: この skill に留まる。分岐が多い場合だけ `grill-me`
- requirements 完了、順序設計が必要: `task-planning`
- requirements 完了、編集可能: `implementation`
- 挙動保持の整理: `refactoring`
- review が目的: `code-review`

`unknown` が残る間は `implementation` に渡さない。

## template

```markdown
# Requirements: <title>

## Objective

<One sentence stating what must be achieved.>

## Scope

- In scope:
  - <item>
- Out of scope:
  - <item>

## Binding metadata

- task_slug: <slug>
- source request summary: <brief summary>
- target repository or path: <repo or path>
- base_commit: <commit hash or `unknown`>
- status: draft | active | superseded | done
- superseded_by: <slug or `none`>

## Binding rules

- <binding rules from this skill>

## Atomic requirements

### R-1: <short label>

- Type: capability | constraint | quality
- Normalized statement: <EARS-style statement or precise equivalent>
- Source: <where the requirement comes from>
- Target: <system, file, behavior, or artifact being changed>
- Desired change: <what must change>
- Invariants: <what must remain true>
- Constraints: <boundaries on the solution>
- Acceptance criteria: <measurable done conditions>
- Verification method: <how to confirm the requirement>
- Affected tests: <tests to add, update, check, or `None identified.`>
- Affected docs: <docs to add, update, check, or `None identified.`>
- Attribute status:
  - source: user_provided | repo_derivable | public_fact | unknown
  - target: user_provided | repo_derivable | public_fact | unknown
  - desired change: user_provided | repo_derivable | public_fact | unknown
  - invariants: user_provided | repo_derivable | public_fact | unknown
  - constraints: user_provided | repo_derivable | public_fact | unknown
  - acceptance criteria: user_provided | repo_derivable | public_fact | unknown
  - verification method: user_provided | repo_derivable | public_fact | unknown
  - affected tests: user_provided | repo_derivable | public_fact | unknown
  - affected docs: user_provided | repo_derivable | public_fact | unknown

## Open questions

- [ ] <only true unknowns>

## Handoff recommendation

- Next capability set: <skills>
- Why: <one short explanation>
```

## 完了チェック

- 実装依頼を最初の要求として扱った。
- atomic requirement に分割した。
- 全必須 field と status を埋めた。
- 調査前の質問を避けた。
- 未解決質問は真の `unknown` だけ。
- artifact を `.opencode/work/` に書いた。
- next capability set が最小十分。
