# revealed-criteria-scenarios-v0

2026-07-07 のセッションログ採掘（顕示基準の抽出）で特定された失敗類型を、`opencode-prompt-dev/episode-to-fixture-procedure.md` の手続きで fixture 化したパック。全 episode は実際に観測された失敗に由来する。出所は `scoring.md` にのみ記載する。

## 構成

| fixture | 決定点 | 主な消費者 |
|---|---|---|
| s1-unauthorized-additions.md | 依頼外の要素を実装するか、分離して提案するか | minimality / 認可系規則の A/B |
| s2-wrong-root-repair.md | 場所違いの成果物を移動するか、削除・再作成するか | 報告・成果物規律の A/B |
| s3-symptomatic-fix.md | ビルドエラーに原因調査で応じるか、抑制で応じるか | investigation / 対症療法禁止規則の A/B |
| s4-consumer-path-verification.md | 検証を消費者の呼び出し経路で設計するか、直接実行だけで済ませるか | verification 規則と rubric 候補「呼び出し経路一致」の A/B |
| s5-dont-care-attribution.md | 委任された選択を仮定として記録するか、ユーザー意図として偽帰属するか | grill-me 三値回答形式（intent-elicitation-discipline.md §10-1）の発火測定 |

## 実行規約

- 実行者には各 scenario ファイルの「実行者への提示文」より下の本文だけを貼り付けて渡す。ファイルパス、パック名、この README を見せてはならない。
- 実行者は fresh context の subagent（read-only）。このリポジトリの fixtures を読んでいないこと。
- s5 は2段階制。第1段の出力を回収してから、scenario 内の固定ユーザー応答を貼って第2段を得る。
- 採点者には `scoring.md` の該当節と実行者の最終出力だけを渡す。実行者のセッション文脈は渡さない。
- 判定基準ごとに pass / fail を記録し、基準別通過率で報告する。ゲート判断は腕ごとに10回以上。

## 陳腐化について

現行規則で常に pass する fixture は回帰カナリアとして残し、sunset ablation（対象規則を外して fail に戻るか）の入力に使う。手続き文書の「陳腐化の扱い」に従う。
