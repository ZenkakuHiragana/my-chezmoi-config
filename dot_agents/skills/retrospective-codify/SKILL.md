---
name: retrospective-codify
description: Use when a task required trial and error and the user wants reusable lessons codified into AGENTS.md, a skill, or a static rule; not for one-off notes or tasks with no generalizable lesson. 学びの整理専用。再利用可能な規則候補と置き場を提案する。
---

# Retrospective Codify

タスク終盤に「最初に知っていれば遠回りしなかった」知見を取り出し、lint、AGENTS.md、skill のどこへ残すべきか判定する。
承認なしに書き出さない。まず提案だけ返し、ユーザーが採用した項目だけ反映する。

## 手順

1. 最初の失敗、最終解、橋渡しの気付きを対応付ける。
2. 「最初に知るべきだったこと」を命令形で 1 から 3 文にする。
3. 適用範囲、静的検出可能性、手順性、既存成果物への依存を判定する。
4. 既存 skill、AGENTS.md、rules を検索して重複確認する。
5. 出力先を選ぶ。
6. 提案だけ返す。ユーザーが採用を指示した項目だけ書き出す。

## 重複確認

気付きから 2 から 3 個の検索キーを作る。

最低限見る:

- `dot_agents/skills/*/SKILL.md`
- `dot_config/opencode/AGENTS.md`
- project `AGENTS.md`
- project `rules/`

分類:

- `新規`: 既存なし
- `既存追記`: 既存を補完する
- `既存と重複`: 完全カバー済み
- `判断保留`: 重複判定できない

## 出力先

| 条件                             | 出力先                   |
| -------------------------------- | ------------------------ |
| 構文レベルで機械検出可能         | `ast-grep` / linter rule |
| 言語横断・ツール横断の短い一般則 | AGENTS.md                |
| 手順、判断、テンプレが必要       | skill                    |
| 単一 task 固有                   | 採用しない               |

静的検出できる内容なら、prompt より lint を優先する。

## 提案形式

```markdown
## Retrospective

### 学び 1: <label>

- 最初の失敗: <1 line>
- 最終解: <1 line>
- 気付き: <1 line>

## 提案

採用候補:

- [lint] <rule>: <1 line>（学び 1 由来）
- [skill 追記] <skill>: <1 line>（学び 1 由来）
- [skill 新規] <skill>: <1 line>（学び 1 由来）
- [rule] AGENTS.md: <1 line>（学び 1 由来）

重複検出（提案不要）:

- 学び 1: 既存 <skill/rule> の <section/line> が完全カバー

不採用:

- 学び 1: <reason>
```

空の section は省く。
採用候補がない場合は、末尾を `採用候補なし。記録目的でレビューしてください。` にする。

## 危険な兆候

- project 固有の知見を汎用 skill に入れる。
- 承認前に書き出す。
- lint 可能な内容を自然言語ルールだけにする。
- 薄い学びを無理に残す。
- 重複確認を省く。
- 最初の失敗を省く。

## 完了チェック

- 失敗と最終解を対応付けた。
- 重複確認をした。
- 出力先を分類軸で選んだ。
- 提案と書き出しを分けた。
- 採用候補、重複、不採用を明示した。
