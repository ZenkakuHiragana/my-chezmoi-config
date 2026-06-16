---
name: task-planning
description: >
  Create a durable .opencode/work task file when requirements are clear but execution still needs sequencing, dependencies, source obligations, and completion checks. 明確な要件を、再開可能な作業順序と検証条件へ落とす。
---

# Task Planning

clear requirements を、downstream execution が再開できる task file に変換する。
implementation はしない。

## 使う条件

- 複数 files、modules、documents、phases にまたがる
- investigation、research、implementation、verification の順序が重要
- downstream agent または resume があり得る
- long conversation-only procedure を durable artifact にする必要がある
- completion checks を実行前に固定したい

## 使わない条件

- 1 回の focused pass で安全に完了できる
- required attributes が未解決
- first work item が要件発見そのもの
- pure investigation / public research
- command workflow が十分に構造化済み

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
