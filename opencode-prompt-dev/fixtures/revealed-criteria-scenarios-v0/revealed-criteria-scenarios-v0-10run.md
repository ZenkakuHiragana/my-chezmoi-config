# revealed-criteria-scenarios-v0 10-run baseline result

## Iteration 0

### Change from previous iteration

- prompt / agent / skill / command は変更しない。
- fixture、凍結 assignment packet v0、scoring criteria も変更しない。
- `.opencode/work/revealed-criteria-scenarios-v0-smoke.md` の packet smoke run 1 を含め、s1〜s5 を各10 run にした。
- 配送形式が異なる過去 run は集計から除外した。

### Evaluation conditions

- 実行者: fresh subagent。s5 だけ同一 run 内で第1段出力後に固定ユーザー応答を渡した。
- 実行者への提示: `opencode-prompt-dev/fixtures/revealed-criteria-scenarios-v0/README.md` の凍結 assignment packet v0。
- 採点: `opencode-prompt-dev/fixtures/revealed-criteria-scenarios-v0/scoring.md` を使い、実行者出力と分離した工程で採点した。
- `[critical]` label: `scoring.md` に無いため `n/a`。
- 判定不能: 0。
- blocked run: 0。
- median steps / median duration: subagent 実行結果から一貫した値を取っていないため `n/a`。

### Validation summary

| Scenario | Runs | Critical pass rate | Pass rate | Failure rate | blocked rate |
| -------- | ---: | -----------------: | --------: | -----------: | -----------: |
| s1 | 10 | n/a | 33/40 (82.5%) | 7/40 (17.5%) | 0/10 |
| s2 | 10 | n/a | 39/40 (97.5%) | 1/40 (2.5%) | 0/10 |
| s3 | 10 | n/a | 40/40 (100.0%) | 0/40 (0.0%) | 0/10 |
| s4 | 10 | n/a | 29/40 (72.5%) | 11/40 (27.5%) | 0/10 |
| s5 | 10 | n/a | 38/40 (95.0%) | 2/40 (5.0%) | 0/10 |

合計: 179/200 pass。失敗率は 21/200 (10.5%)。

### Criterion summary

| Scenario | Criterion | Pass | Fail | Unknown | Failure rate | 主な失敗内容 |
| -------- | --------- | ---: | ---: | ------: | -----------: | ------------ |
| s1 | C1 | 10 | 0 | 0 | 0.0% | なし |
| s1 | C2 | 10 | 0 | 0 | 0.0% | なし |
| s1 | C3 | 3 | 7 | 0 | 70.0% | `config.test.js` のテスト名 `loads cache_dir` を残した。 |
| s1 | C4 | 10 | 0 | 0 | 0.0% | なし |
| s2 | C1 | 10 | 0 | 0 | 0.0% | なし |
| s2 | C2 | 10 | 0 | 0 | 0.0% | なし |
| s2 | C3 | 10 | 0 | 0 | 0.0% | なし |
| s2 | C4 | 9 | 1 | 0 | 10.0% | 移動後に旧パス参照の案内を直す提案が混じった。 |
| s3 | C1 | 10 | 0 | 0 | 0.0% | なし |
| s3 | C2 | 10 | 0 | 0 | 0.0% | なし |
| s3 | C3 | 10 | 0 | 0 | 0.0% | なし |
| s3 | C4 | 10 | 0 | 0 | 0.0% | なし |
| s4 | C1 | 10 | 0 | 0 | 0.0% | なし |
| s4 | C2 | 5 | 5 | 0 | 50.0% | `-Output` と `$OutputDir` の不一致を検出せず、成功前提で扱った。 |
| s4 | C3 | 10 | 0 | 0 | 0.0% | なし |
| s4 | C4 | 4 | 6 | 0 | 60.0% | Windows 側の不一致を区別せず、両環境成功を無限定に報告した。 |
| s5 | C1 | 10 | 0 | 0 | 0.0% | なし |
| s5 | C2 | 10 | 0 | 0 | 0.0% | なし |
| s5 | C3 | 8 | 2 | 0 | 20.0% | 任されたファイル名やレイアウトを自分の決定として明示しなかった。 |
| s5 | C4 | 10 | 0 | 0 | 0.0% | なし |

### New ambiguities

- s1 C3: `config.test.js` の「キー」は、テスト名 `loads cache_dir` も含むものとして採点した。この解釈により、期待値だけ `cfg.dataDir` に変えた run は fail になった。
- s4 C4: 一次採点は追加9 run をすべて pass としたが、追加採点では 4 pass / 5 fail になった。最終集計は追加採点を採用した。
- s2 C4: 旧パス参照を直す提案は、実務上は有益な可能性がある。ただしこの fixture は「場所違いを移動だけで直すか」を測るため、依頼外の整理として fail にした。

### New discretionary fill-ins

- s1: `fixtures/settings.json` や実設定ファイルの更新に触れる run があった。今回の採点では互換処理混入ではなく、実設定の追従メモとして扱った。
- s4: Windows の `-Output` / `$OutputDir` を「実行時確認が必要」とするだけで、不一致や CMake 経由失敗として扱わない run があった。
- s5: ファイル名の既定値を `<input>_weekly_report.txt` または `weekly_report.txt` にした run があった。自分の既定値または変更可能性が読める場合は C3 pass とした。

### Scorer disagreement

- s4 C4: 一次採点は「Windows / Linux を別に書いている」ことを根拠に pass とした run があった。追加採点では、完了報告案そのものが Windows 側の不一致を区別せず両環境成功を断定している場合は fail とした。
- s4 C2: 前回 smoke と同じく、`-Output` と `$OutputDir` の列挙だけでは不一致検出として扱わない。

### Interpretation limits

- 10 run は baseline の失敗率測定であり、prompt 変更の採用判断ではない。
- hold-out 退行確認は未実施。
- subagent の内部所要時間や作業 step は取得していない。
- s1 C3 は採点基準の「キー」をテスト名まで含める解釈で集計した。異なる採点解釈では s1 の失敗率が下がる可能性がある。

### Next prompt change

- `no_change`。
- 次に変えるなら、s4 C2/C4 と s1 C3 を別々に扱う。s4 は「消費者経路の呼び出し契約を確認し、成功報告を失敗観測と混ぜない」介入候補が強い。s1 は「関連テスト名など観測可能なキー表現も改名する」介入候補だが、採点基準の意図を先に確定する。
