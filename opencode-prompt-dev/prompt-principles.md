# Prompt 管理原則 (prompt-principles.md)

## 目的

- プロンプトを通常のコードや仕様と同様に保守対象として扱うための最小原則と運用ルールを定義する。

## 改善介入ポリシー

- local failure-log root は `~/.local/share/chezmoi/.opencode/local-failure-logs/` とする。
  - 個別失敗事例は root 直下に Markdown として記録する。
  - 過去セッション採掘レポートは `session-mining/` に保存する。
  - 蓄積事例の triage レポートは `triage/` に保存する。
- failure-log は、改善対象となる実際の失敗・迷走・非効率・誤判断の観測事例を記録する場所とする。
- failure-log はプロンプト修正要求ではない。各事例は、後段の triage で介入要否と介入種別を判断するための証拠である。
- 演習・訓練・検証だけの記録は、実際の失敗事例と混ぜず、別の検証記録として扱う。
- tracked repository files には、生ログ・未整理の失敗証拠・長い会話断片ではなく、検証済みの運用原則・プロンプト変更・チェックリストのみを残す。

## 現行カバレッジ確認ポリシー

- 過去セッションから抽出した失敗事例は、現行プロンプトの未修正問題とは限らない。
- 古い失敗事例を corrective action に進める前に、現行の prompt / skill / agent / command / routing / hook / harness / artifact 構成で既に対策済みかを確認する。
- 既に対策済みの失敗は、追加のプロンプト変更ではなく、必要に応じて回帰検証シナリオとして扱う。
- 現行プロンプトに関連する規則があるだけでは、対策済みとはみなさない。少なくとも trigger、required action、forbidden behavior、validation target、routing、artifact、hook、harness のいずれかが具体的に存在することを確認する。
- 現行カバレッジが `unknown` の場合は、通常の改善ではなく、まず triage で確認する。

## 介入種別の選択方針

- 改善手段は prompt edit に限定しない。
- triage では、少なくとも次の介入種別を比較する。
  - no change
  - 回帰検証シナリオ
  - 既存文言の削除・言い換え・統合・移設
  - skill の分割・統合・新設・削除
  - command redesign
  - agent routing または model / reasoning-effort routing の変更
  - artifact schema、状態ファイル、evidence map、index などの導入
  - plugin / hook / harness による機械的な検査・保存・完了ゲート
  - empirical-prompt-tuning または retrospective-codify への移送
- 原則として、最小で検証可能な介入を選ぶ。
- prompt の追記は、最小介入の一種でしかない。再発防止に必要な制御が prompt では安定しない場合は、hook、harness、artifact、workflow の変更を優先して検討する。
- 一件の弱い失敗から global rule を追加してはならない。
- 既存文言の削除・言い換え・統合・移設で足りる場合は、新規ルールを追加しない。
- 新規ルールを追加してよいのは以下をすべて満たす場合だけ：
  1. 現行システムで未対応の `active_gap` である
  2. 既存規則で包含できない
  3. 既存規則の表現を整理しても防げない
  4. 配置変更や skill 化だけで解決しない
  5. hook、artifact、harness ではなく prompt に置く方が適切である
  6. 新規規則の方が既存規則群より短く明確である
  7. 検証方法または回帰シナリオを定義できる

## リファクタリングのトリガー

- 同じ趣旨の規則を2回以上追加した
- 同じ失敗が別の agent / skill でも起きた
- 常設 prompt の一部が 20〜30% 以上増えた
- 新しい skill を作った、または AGENTS.md に task-specific な文が増えた
- failure-log の triage で、prompt ではなく hook、harness、artifact、agent routing、workflow contract が適切だと判断された
- 古い失敗事例と現行システムの対策済み事例が混ざり、追加修正と回帰検証の区別が曖昧になった

## 運用フロー

- 新しい失敗が起きたとき
  1. local failure-log root に事例ごとのファイルとして記録する
  2. 現象、推定原因、介入候補を分ける
  3. 現行システムで既に対策済みか確認する
  4. `active_gap` の場合のみ corrective action 候補に進める
  5. `covered_but_unvalidated` の場合は、追加修正ではなく回帰検証候補にする
  6. `likely_addressed` / `obsolete_context` の場合は historical note に留める
- 一定量たまったら
  1. triage で観測現象ごとにクラスタリングする
  2. 現行カバレッジを確認し、`obsolete_context` / `likely_addressed` / `covered_but_unvalidated` / `active_gap` / `unknown` を分ける
  3. `active_gap` と高リスクの `unknown` だけを改善介入の主対象にする
  4. prompt edit、skill 変更、command redesign、agent routing、artifact、hook、harness、検証シナリオ、no change を比較する
  5. 最小で検証可能な介入を選ぶ
  6. 差分レビューを行い、必要な補足は関連する incident report または triage report に残す

## 関連ファイル

- opencode-prompt-dev/prompt-principles.md
  - このファイル。プロンプト改善と改善介入の管理原則を示す。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/`
  - local-only の失敗・採掘・triage 記録。生ログや未整理の証拠はここに閉じる。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/session-mining/`
  - 過去セッションから抽出した失敗候補と傾向分析を保存する。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/triage/`
  - 蓄積した失敗事例の分析、現行カバレッジ判定、介入案、検証案を保存する。
- opencode-prompt-dev/prompt-refactor-checklist.md
  - 冗長な記載、曖昧なルール、過剰な prompt edit を避けるためのチェックリスト。
