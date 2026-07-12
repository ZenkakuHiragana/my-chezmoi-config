---
name: task-planning
description: >
  Use when `Readiness record` is `pass` or `pass_with_assumption`, or when a fixed `Requirement contract` / other `task contract` already exists, but execution still needs ordered work items, dependencies, read/write surfaces, handoff points, or completion checks captured in a durable task file; not when stage, scope, acceptance criteria, or verification are still unsettled, or when one focused pass can finish safely. 実行計画の固定専用。再開可能な task file と次の skill を返す。
---

# Task Planning

固定済みの作業契約を、後続の実行者が再開できる task file に変換する。
この skill では実装しない。
scope、invariants、acceptance criteria、verification method を新しく決めない。ここが動く場合は `context-clarification` に戻す。

## 入力

- 明確な作業説明
- `Readiness record` が `pass` または `pass_with_assumption`、または同等の準備完了判定
- `Requirement contract`（`context-clarification` が出す `task contract`）または同等の `task contract`
- リポジトリ文脈
- 明示されたユーザー制約または決定

## 出力

- `.opencode/work/<slug>.md`（task file）
- `.opencode/work/current-task.md` には slug だけ
- 次の capability set

`Requirement contract` は `context-clarification` が `.opencode/work/<slug>.contract.md` に固定したものを読む。task file はこれとは別ファイルに書き、契約ファイルを上書きしない。

`current-task.md` は、継続依頼なのに task の識別子が会話から分からない場合だけ見る。
現在依頼が明確なら無視する。

## タスクファイルのルール

- 1 task は 1 file にする。
- `.opencode/work/current-task.md` には slug だけを書く。
- 作業項目は、後続実行者が再設計せずに実行できる粒度にする。
- 依存関係、read set、write set、side_effect_mode、verification を明示する。
- 外部またはローカルの事実が必要なら、実行前に集める事実として書く。
- 会話にしかない制約をタスクファイルに移す。
- review結果へ対応するtaskでは、修正前の再現、まとめた修正、同じ確認方法による修正後確認を順に書く。
- 契約を変えずに切り分ける不明点には、固定済み契約を変えずに切り分けできるものだけを書く。scope や受け入れ条件を動かす不明点は `context-clarification` に戻す。

## 手順

1. `Readiness record` が `pass` / `pass_with_assumption`、または同等の固定済み契約があるか確認する。
2. 関連するリポジトリ文脈を読む。
3. 結果、制約、入力を書く。
4. 関連面と採用方針を書く。
5. 集める事実と、契約を変えずに止める不明点を分ける。
6. review結果へ対応するtaskでは、修正前の再現、修正、修正後確認を一方向のwork itemとして書く。
7. 作業項目を phase、dependencies、parallel group、execution、side effect mode、read/write set、deliverables、verification 付きで書く。
8. 完了前の確認を定義する。
9. タスクファイルと current-task の参照先を書く。
10. next capability set を示す。

## template

```markdown
# Task: <title>

## Requested outcome

- <what must be achieved>

## Constraints

- <what must remain true>

## Inputs

- <`Requirement contract`、他の `task contract`、調査メモ、issue、ユーザー判断、または旧形式の requirements file>

## Relevant surfaces

- <files, directories, commands, outputs, artifacts>

## Binding metadata

- task_slug: <slug>
- source request summary: <brief summary>
- target repository or path: <repo or path>
- base_commit: <commit hash or `unknown`>
- status: draft | active | superseded | done
- superseded_by: <slug or `none`>

## Binding rules

- <binding rules from context-clarification>

## Chosen approach

- <brief execution shape>

## Facts to gather

- <facts required before action>

## 契約を変えずに切り分ける不明点

- <unknowns that block dependent items>

## Work items

### W-1: <short imperative title>

- **Phase**: investigate | review | implement | writing | verify | audit
- **Dependencies**: none | W-x
- **Parallel group**: none | PG-x
- **Execution**: parent | subagent
- **Side effect mode**: read_only | write_disjoint | none
- **Parallel basis**: domain | surface | review | none
- **Read set**:
  - <sources>
- **Write set**:
  - <files or `None`>
- **Description**: <concrete work>
- **Research needed**: none | <required research>
- **Deliverables**: <outputs>
- **Verification**: <check>

## レビュー確認

- <None identified. または問題ごとの対象、観点、場所、破綻、根拠、修正前後に使う同じ確認方法>

## Checks before completion

- <cross-item checks>
```

空欄禁止。該当なしは `None identified.`。

## 完了チェック

- タスクファイルが既知の要件から埋まっている。
- 要件上の義務を保持した。
- 関連するリポジトリ文脈を確認した。
- 作業項目が具体的。
- dependencies と verification が明示されている。
- scope や acceptance criteria を勝手に増減していない。
- review結果へ対応するtaskでは、修正前の再現が実装work itemより前にある。
- review結果へ対応するtaskでは、修正後に同じ確認方法とtask contractのtestsを実行する。
- current-task は slug のみ。
- next capability set が最小十分。
