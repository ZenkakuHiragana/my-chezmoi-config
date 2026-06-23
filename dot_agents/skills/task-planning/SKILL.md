---
name: task-planning
description: >
  Use when requirements are already clear but execution still needs ordered work items, dependencies, read/write surfaces, handoff points, or completion checks captured in a durable task file; not when requirements are still unclear or one focused pass can finish safely. 実行計画の固定専用。再開可能な task file と次の skill を返す。
---

# Task Planning

確定した要件を、後続の実行者が再開できるタスクファイルに変換する。
この skill では実装しない。

## 入力

- 明確な作業説明
- requirements artifact または同等の task contract
- リポジトリ文脈
- 明示されたユーザー制約または決定

## 出力

- `.opencode/work/<slug>.md`
- `.opencode/work/current-task.md` には slug だけ
- 次の capability set

`current-task.md` は、継続依頼なのに task の識別子が会話から分からない場合だけ見る。
現在依頼が明確なら無視する。

## タスクファイルのルール

- 1 task は 1 file にする。
- `.opencode/work/current-task.md` には slug だけを書く。
- 作業項目は、後続実行者が再設計せずに実行できる粒度にする。
- 依存関係、read set、write set、side_effect_mode、verification を明示する。
- 外部またはローカルの事実が必要なら、実行前に集める事実として書く。
- 会話にしかない制約をタスクファイルに移す。

## 手順

1. 要件がタスクファイル化できるほど確定しているか確認する。
2. 関連するリポジトリ文脈を読む。
3. 結果、制約、入力を書く。
4. 関連面と採用方針を書く。
5. 集める事実と、作業を止める不明点を分ける。
6. 作業項目を phase、dependencies、parallel group、execution、side effect mode、read/write set、deliverables、verification 付きで書く。
7. 完了前の確認を定義する。
8. タスクファイルと current-task の参照先を書く。
9. next capability set を示す。

## template

```markdown
# Task: <title>

## Requested outcome

- <what must be achieved>

## Constraints

- <what must remain true>

## Inputs

- <requirements file, research note, issue, or user decision>

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

- <binding rules from requirements-clarification>

## Chosen approach

- <brief execution shape>

## Facts to gather

- <facts required before action>

## Blocking unknowns

- <unknowns that block dependent items>

## Work items

### W-1: <short imperative title>

- **Phase**: investigate | implement | verify
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
- current-task は slug のみ。
- next capability set が最小十分。
