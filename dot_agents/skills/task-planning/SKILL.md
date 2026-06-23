---
name: task-planning
description: >
  Use when requirements are already clear but execution still needs ordered work items, dependencies, read/write surfaces, handoff points, or completion checks captured in a durable task file; not when requirements are still unclear or one focused pass can finish safely. 実行計画の固定専用。再開可能な task file と次の skill を返す。
---

# Task Planning

clear requirements を、downstream execution が再開できる task file に変換する。
implementation はしない。

## 入力

- clear task description
- requirements artifact or equivalent task contract
- repository context
- explicit user constraints / decisions

## 出力

- `.opencode/work/<slug>.md`
- `.opencode/work/current-task.md` with slug only
- next capability set

`current-task.md` は continuation の task identity が会話から欠ける場合だけ見る。
現在依頼が明確なら無視する。

## task file rules

- 1 task = 1 file。
- `.opencode/work/current-task.md` には slug だけを書く。
- work items は downstream が再構成なしで実行できる粒度にする。
- dependencies、read set、write set、side effect mode、verification を明示する。
- external/local facts が必要なら実行前 research として書く。
- conversation-only constraints を task file に移す。

## 手順

1. requirements が task file 化できるほど確定しているか確認する。
2. relevant repo context を読む。
3. outcome、constraints、inputs を書く。
4. relevant surfaces と chosen approach を書く。
5. facts to gather と blocking unknowns を分ける。
6. work items を phase、dependencies、parallel group、execution、side effect mode、read/write set、deliverables、verification 付きで書く。
7. checks before completion を定義する。
8. task file と current-task pointer を書く。
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

- task file が known requirements から埋まる
- requirement obligations を保持した
- relevant repo context を確認した
- work items が具体的
- dependencies と verification が明示
- current-task は slug のみ
- next capability set が最小十分
