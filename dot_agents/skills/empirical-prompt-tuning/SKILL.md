---
name: empirical-prompt-tuning
description: Use when a prompt, skill, command, or agent instruction has been created or substantially changed and needs empirical validation with frozen scenarios and fresh executors; not for one-off prompts or preference-only wording tweaks. 実験的な検証専用。比較可能な評価結果と改善判断を返す。
---

# Empirical Prompt Tuning

prompt author の self-reread を信頼しすぎない。
frozen scenarios、fresh executors、separate scoring で instruction change を検証する。

dispatch 不可なら `empirical evaluation skipped: dispatch unavailable` と明示する。
self-reread を empirical evaluation と呼ばない。

## principles

- evaluation design を実行前に freeze する。
- executor は scoring checklist、variant label、intended improvement を見ない。
- scoring は executor と分離する。
- requirement ごとに evidence-backed score を付ける。
- single run で採用判断しない。
- validation で改善しても hold-out regression を確認する。

## iteration 0

dispatch 前に static description-body alignment を確認する。

- frontmatter `description` の promise
- body が実際に命じる行動
- use / do-not-use 条件
- expected output

不一致があれば empirical run 前に直す。

## experiment plan

freeze fields:

- target prompt
- failure modes
- included / excluded task types
- scenario set or split
- requirements checklist
- `[critical]` labels
- scoring rules
- repeat count
- randomization / counterbalancing
- comparison rule
- stop rule
- adoption rule
- allowed changes after freeze

plan を見た後に scenario/checklist/critical labels を動かすなら version を上げ、baseline からやり直す。

## scenario split

重要 prompt:

- `train`: fix 設計に使う
- `validation`: iteration ごとに固定再実行
- `hold-out`: adoption 前だけ確認

scenarios は typical、edge、missing-info、tool-heavy、known-failure、should-not-use を混ぜる。

## packets

Executor run packet:

- target prompt
- scenario
- required input paths/files
- task
- report structure

Scoring packet:

- frozen checklist
- scoring rules
- critical labels
- admissible evidence

executor に scoring packet を渡さない。

## executor report

- Deliverable
- Execution summary
- Ambiguities
- Discretionary fill-ins
- Blocked areas
- Retries
- Self-assessed uncertainty

## scorer report

```json
{
  "requirement_id": "R3",
  "judgment": "pass | partial | fail",
  "evidence": "artifact or admissible evidence",
  "missing": "what is absent",
  "confidence": "high | medium | low"
}
```

Success:

- all `[critical]` requirements are `pass`

Pass rate:

- `pass` = 1
- `partial` = 0.5
- `fail` = 0

## comparison

prompt variants は A/B 匿名化し、必要なら order を randomize/counterbalance する。
prose-heavy outputs は paired comparison を追加してよい。

## adoption signals

Primary:

- critical pass rate
- requirement pass rate
- blocked-run rate
- new ambiguities
- new discretionary fill-ins

Supporting:

- median tool uses
- median duration
- retries
- output length when suspicious

adoption 目安:

- validation critical pass rate が baseline 以上
- total score が改善、または execution burden が下がり critical failures が増えない
- scorer disagreement が悪化しない
- hold-out が崩れない

## 手順

1. Iteration 0 static alignment を行う。
2. experiment plan を freeze する。
3. scenario set と packets を作る。
4. fresh blinded executors を走らせる。
5. fixed outputs を separate scorer が採点する。
6. variants または iterations を比較する。
7. 最小 prompt change を 1 coherent theme だけ適用する。
8. 同じ validation scenarios を fresh executors で再実行する。
9. improvement が頭打ちになったら hold-out を確認する。
10. adoption、next change、または rollback を決める。

## output

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

- evaluation design を freeze した
- executor は blinded fresh session
- scorer は separate pass
- requirement-level evidence がある
- critical failures を平均点で隠していない
- hold-out regression を確認した、または未実施理由を明示した
