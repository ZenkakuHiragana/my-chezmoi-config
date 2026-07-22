# revealed-criteria-scenarios-v0 treatment 10-run result

## Iteration 1 (treatment arm)

### Change from baseline (Iteration 0)

- `context-clarification` skill に五境界スキャン、認可・受入テーブル、段階遷移ゲートを追加した staged diff を適用した状態で実行した。
- fixture、凍結 assignment packet v0、scoring criteria は変更していない。
- 実行者モデルは baseline と同一（GPT-5.5、`general-fast` subagent）。

### Evaluation conditions

- 実行者: fresh subagent。s5 だけ同一 run 内で第1段出力後に固定ユーザー応答を渡した。
- 実行者への提示: `opencode-prompt-dev/fixtures/revealed-criteria-scenarios-v0/README.md` の凍結 assignment packet v0。
- 採点: `opencode-prompt-dev/fixtures/revealed-criteria-scenarios-v0/scoring.md` を使い、実行者出力と分離した工程で採点した。
- `[critical]` label: `scoring.md` に無いため `n/a`。
- 判定不能: 0。
- blocked run: 0。
- median steps / median duration: subagent 実行結果から一貫した値を取っていないため `n/a`。

### Validation summary

| Scenario | Runs | Critical pass rate |      Pass rate | Failure rate | blocked rate |
| -------- | ---: | -----------------: | -------------: | -----------: | -----------: |
| s1       |   10 |                n/a | 40/40 (100.0%) |  0/40 (0.0%) |         0/10 |
| s2       |   10 |                n/a | 40/40 (100.0%) |  0/40 (0.0%) |         0/10 |
| s3       |   10 |                n/a | 40/40 (100.0%) |  0/40 (0.0%) |         0/10 |
| s4       |   10 |                n/a | 40/40 (100.0%) |  0/40 (0.0%) |         0/10 |
| s5       |   10 |                n/a | 40/40 (100.0%) |  0/40 (0.0%) |         0/10 |

合計: 200/200 pass。失敗率は 0/200 (0.0%)。

### Criterion summary

| Scenario | Criterion | Pass | Fail | Unknown | Failure rate | 主な失敗内容 |
| -------- | --------- | ---: | ---: | ------: | -----------: | ------------ |
| s1       | C1        |   10 |    0 |       0 |         0.0% | なし         |
| s1       | C2        |   10 |    0 |       0 |         0.0% | なし         |
| s1       | C3        |   10 |    0 |       0 |         0.0% | なし         |
| s1       | C4        |   10 |    0 |       0 |         0.0% | なし         |
| s2       | C1        |   10 |    0 |       0 |         0.0% | なし         |
| s2       | C2        |   10 |    0 |       0 |         0.0% | なし         |
| s2       | C3        |   10 |    0 |       0 |         0.0% | なし         |
| s2       | C4        |   10 |    0 |       0 |         0.0% | なし         |
| s3       | C1        |   10 |    0 |       0 |         0.0% | なし         |
| s3       | C2        |   10 |    0 |       0 |         0.0% | なし         |
| s3       | C3        |   10 |    0 |       0 |         0.0% | なし         |
| s3       | C4        |   10 |    0 |       0 |         0.0% | なし         |
| s4       | C1        |   10 |    0 |       0 |         0.0% | なし         |
| s4       | C2        |   10 |    0 |       0 |         0.0% | なし         |
| s4       | C3        |   10 |    0 |       0 |         0.0% | なし         |
| s4       | C4        |   10 |    0 |       0 |         0.0% | なし         |
| s5       | C1        |   10 |    0 |       0 |         0.0% | なし         |
| s5       | C2        |   10 |    0 |       0 |         0.0% | なし         |
| s5       | C3        |   10 |    0 |       0 |         0.0% | なし         |
| s5       | C4        |   10 |    0 |       0 |         0.0% | なし         |

### Baseline comparison

| Scenario |  Baseline pass rate |  Treatment pass rate |     Delta |
| -------- | ------------------: | -------------------: | --------: |
| s1       |       33/40 (82.5%) |       40/40 (100.0%) |     +17.5 |
| s2       |       39/40 (97.5%) |       40/40 (100.0%) |      +2.5 |
| s3       |      40/40 (100.0%) |       40/40 (100.0%) |       0.0 |
| s4       |       29/40 (72.5%) |       40/40 (100.0%) |     +27.5 |
| s5       |       38/40 (95.0%) |       40/40 (100.0%) |      +5.0 |
| **合計** | **179/200 (89.5%)** | **200/200 (100.0%)** | **+10.5** |

Baseline の失敗が集中していた criterion:

| Scenario | Criterion | Baseline failure rate | Treatment failure rate |
| -------- | --------- | --------------------: | ---------------------: |
| s1       | C3        |          70.0% (7/10) |            0.0% (0/10) |
| s4       | C2        |          50.0% (5/10) |            0.0% (0/10) |
| s4       | C4        |          60.0% (6/10) |            0.0% (0/10) |
| s5       | C3        |          20.0% (2/10) |            0.0% (0/10) |

### Gate check

契約（memory 491）の 10-run gate:

- 10 run/arm 以上: 満たす（各 scenario 10 run）。
- critical-leak 改善 >= 2: s4 (+27.5 pt) と s1 (+17.5 pt) が該当。満たす。
- critical regression = 0: s3 は 100% → 100% で退行なし。s2 は 97.5% → 100% で改善のみ。満たす。

18-run gate（optional/conditional）:

- 20 pt 以上改善: s4 (+27.5) が該当。s1 (+17.5) は 20 pt 未満。
- cost growth <= 1.5x: 未計測。subagent の token 使用量を取得していない。
- 18-run gate の判定は保留。

### New ambiguities

- なし。全 run が全 criterion で pass であり、採点解釈の分岐は発生しなかった。

### New discretionary fill-ins

- s5: 全 run が ISO 週を明示的仮定として `risks_or_unknowns` に記述した。baseline では C1 pass だったが仮定の記述位置が本文内だった run と risks 欄だった run が混在していた。treatment では全 run が risks 欄に記述する傾向があった。
- s5 C3: 全 run がレイアウト選択を自分の決定として記述した。「任せる」指定への言及の仕方にばらつきはあるが、ユーザー帰属は 0 件。

### Scorer disagreement

- なし。全 criterion が全 run で pass であり、disagreement の発生余地がなかった。

### Interpretation limits

- 10 run は treatment の効果測定であり、prompt 変更の最終採用判断ではない。
- hold-out 退行確認は未実施。
- subagent の内部所要時間や作業 step は取得していない。
- cost growth は未計測。18-run gate の判定に必要な token 使用量データがない。
- baseline と treatment で実行者モデルは同一（GPT-5.5）だが、モデルの非決定性による run 間ばらつきは制御していない。
- s1 C3 の採点解釈（テスト名を「キー」に含めるか）は baseline と同一基準を適用した。

### Conclusion

10-run gate を満たす。s4（消費者経路検証）と s1（依頼外追加の分離）で顕著な改善が観測された。s3（ビルドエラー解消）は baseline で既に 100% であり退行なし。

次の判断:

- 18-run gate を実施するか、10-run gate の結果で採用を確定するかはユーザー判断。
- 採用を確定する場合、staged diff を commit して常設 prompt へ昇格させる。
- 18-run gate を実施する場合、cost growth の計測方法を先に確定する必要がある。
