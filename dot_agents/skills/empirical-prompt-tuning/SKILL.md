---
name: empirical-prompt-tuning
description: Use when a prompt, skill, command, or agent instruction has been created or substantially changed and needs empirical validation with frozen scenarios and fresh executors; not for one-off prompts or preference-only wording tweaks. 実験的な検証専用。比較可能な評価結果と改善判断を返す。
---

# Empirical Prompt Tuning

プロンプト作成者の読み直しだけを検証扱いしない。
固定した検証シナリオ、新しい実行者、分離した採点を使い、指示変更が実際に効くか確認する。

委譲実行できない場合は `実験評価を省略: 委譲実行を利用できない` と明示する。
自己読み直しを実験評価と呼ばない。

## 原則

- 評価設計を実行前に固定する。
- 実行者は採点チェックリスト、変種ラベル、意図した改善点を見ない。
- 採点は実行者と分離する。
- requirement ごとに根拠付き score を付ける。
- 1 回の実行だけで採用判断しない。
- validation で改善しても hold-out の退行を確認する。

## 反復 0

委譲実行前に、description と本文の対応を確認する。

- frontmatter `description` の約束
- 本文が実際に命じる行動
- 使用条件 / 不使用条件
- 期待される返答

不一致があれば実験実行の前に直す。

## 実験計画

固定する項目:

- 対象 prompt
- 失敗の型
- 対象に含める / 除外する作業種別
- 検証シナリオの集合または分割
- requirement チェックリスト
- `[critical]` labels
- scoring 規則
- 反復回数
- ランダム化 / 均衡化
- 比較規則
- 停止規則
- 採用規則
- 固定後に許す変更

計画を見た後に検証シナリオ、チェックリスト、critical labels を動かすなら版を上げ、baseline からやり直す。

## 検証シナリオの分割

重要 prompt:

- `train`: 修正設計に使う
- `validation`: 反復ごとに固定再実行
- `hold-out`: 採用前だけ確認

検証シナリオには典型、境界、情報不足、tool 多用、既知失敗、不使用条件の事例を混ぜる。

## 渡す情報

実行者に渡す情報:

- 対象 prompt
- 検証シナリオ
- 必要な入力 path / ファイル
- task
- 報告形式

採点者に渡す情報:

- 固定済みチェックリスト
- scoring 規則
- critical labels
- 採用可能な根拠

実行者に scoring 情報一式を渡さない。

## 実行者の報告

- 成果物
- 実行概要
- 曖昧だった点
- 実行者が補った点
- 詰まった箇所
- やり直し
- 自己評価した不確実性

## 採点者の報告

```json
{
  "requirement_id": "R3",
  "judgment": "pass | partial | fail",
  "evidence": "artifact or admissible evidence",
  "missing": "what is absent",
  "confidence": "high | medium | low"
}
```

成功条件:

- すべての `[critical]` requirement が `pass`

合格率:

- `pass` = 1
- `partial` = 0.5
- `fail` = 0

## 比較

prompt の変種は A/B として匿名化し、必要なら順序をランダム化または均衡化する。
文章量が多い出力では対比較を追加してよい。

## 採用判断の材料

主な材料:

- critical 通過率
- requirement 通過率
- 停止実行率
- 新しい曖昧さ
- 新しい裁量補完

補助材料:

- tool 使用回数の中央値
- 所要時間の中央値
- retries
- 疑わしい場合の出力量

採用判断の目安:

- validation critical 通過率が baseline 以上
- 合計 score が改善、または実行負荷が下がり critical 失敗が増えない
- 採点者の不一致が悪化しない
- hold-out が崩れない

## 手順

1. 反復 0 の静的整合確認を行う。
2. 実験計画を固定する。
3. 検証シナリオの集合と受け渡し資料を作る。
4. 新しい盲検実行者を走らせる。
5. 固定済み出力を別の採点者が採点する。
6. 変種または反復を比較する。
7. 最小の prompt 変更を 1 つのまとまったテーマだけ適用する。
8. 同じ validation 検証シナリオを新しい実行者で再実行する。
9. 改善が頭打ちになったら hold-out を確認する。
10. 採用、次の変更、または取り消しを決める。

## 返す形式

```markdown
## Iteration N

### Change from previous iteration

- <summary>

### Validation summary

| Scenario | Runs | Critical pass rate | Pass rate | median steps | median duration | blocked rate |
| -------- | ---: | -----------------: | --------: | -----------: | --------------: | -----------: |

### New ambiguities

- <scenario>: <requirement and reason>

### New discretionary fill-ins

- <scenario>: <fill-in>

### Scorer disagreement

- <scenario / requirement>: <summary>

### Next prompt change

- <smallest next change>
```

## 完了チェック

- 評価設計を固定した。
- 実行者は評価条件を伏せた新規セッション。
- 採点者は実行者と分離した別工程で採点する。
- requirement-level evidence がある。
- critical failures を平均点で隠していない。
- hold-out の退行を確認した、または未実施理由を明示した。
