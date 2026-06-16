---
name: retrospective-codify
description: Codify task lessons by mapping first failure to final solution and choosing ast-grep, AGENTS.md, or skill updates. タスク終盤の学びを、重複確認のうえ再利用可能なルール候補にする。
---

# Retrospective Codify

タスク終盤に「最初に知っていれば遠回りしなかった」知見を抽出し、静的ルール、AGENTS.md、skill のどれに残すべきか判定する。
勝手に書き出さず、提案してユーザー承認を待つ。

## 使う条件

- ユーザーが「学びを残して」「ルール化して」「skill にして」「lint に落として」と言う
- 試行錯誤の末に解に到達した
- 同種タスクで同じ落とし穴を避けたい

## 使わない条件

- 一発で通った単純作業
- 抽出する汎用知見がない
- 単一 task 固有で commit/PR note で足りる

## 手順

1. 最初の失敗、最終解、橋渡しの気付きを対応付ける。
2. 「最初に知るべきだったこと」を命令形で 1 から 3 文にする。
3. 適用範囲、静的検出可能性、手順性、既存 artifact 依存を判定する。
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

| 条件 | 出力先 |
| --- | --- |
| 構文レベルで機械検出可能 | `ast-grep` / linter rule |
| 言語横断・ツール横断の短い一般則 | AGENTS.md |
| 手順、判断、テンプレが必要 | skill |
| 単一 task 固有 | 採用しない |

静的検出可能なら prompt より lint を優先する。

## 提案 format

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

## red flags

- project 固有なのに skill 化する
- 承認前に書き出す
- lint 可能なものを自然言語だけにする
- 薄い学びを無理に残す
- 重複確認を省く
- 最初の失敗を省く

## 完了チェック

- 失敗と最終解を対応付けた
- 重複確認をした
- 出力先を分類軸で選んだ
- 提案と書き出しを分けた
- 採用候補、重複、不採用を明示した
