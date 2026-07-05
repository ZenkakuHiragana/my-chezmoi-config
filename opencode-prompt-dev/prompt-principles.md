# Prompt 管理原則 (prompt-principles.md)

## 目的

- プロンプトを通常のコードや仕様と同様に保守対象として扱うための最小原則と運用ルールを定義する。

## 改善介入ポリシー

- ローカル失敗ログルートは `~/.local/share/chezmoi/.opencode/local-failure-logs/` とする。
  - 個別失敗事例はルート直下に Markdown として記録する。
  - 過去セッション採掘レポートは `session-mining/` に保存する。
  - 蓄積事例の triage レポートは `triage/` に保存する。
- 失敗ログは、改善対象となる実際の失敗・迷走・非効率・誤判断の観測事例を記録する場所とする。
- 失敗ログはプロンプト修正要求ではない。各事例は、後段の triage で介入要否と介入種別を判断するための証拠である。
- 演習・訓練・検証だけの記録は、実際の失敗事例と混ぜず、別の検証記録として扱う。
- 追跡対象ファイルには、生ログ・未整理の失敗証拠・長い会話断片ではなく、検証済みの運用原則・プロンプト変更・チェックリストのみを残す。

## ターン単位の再分類原則

- 新しいユーザー発話ごとに、前ターンの作業種別、skill、根拠の確認範囲をそのまま継承してよいかを再判定し、必要なら task frame を作り直す。
- 後続質問が、過去の指摘や前提の検証、外部システム・エンジン・ライブラリ・シェーダー・API・実行時オブジェクト・設定キー・ファイルの実挙動確認、またはレビューから `investigation` / 検証 / 監査への切り替えを含む場合、最初の分類に引っ張られたまま回答しない。
- AGENTS.md、プロジェクト規則、ドメインメモ、ユーザー入力が特定領域のローカルリポジトリ、生成済みグラフ、runtime artifact、ログ、原本 path を示している場合、その領域に依存する質問では必要な根拠種別として扱う。
- 公開調査は必要な公開情報を満たせるが、既知のローカル実装根拠要件を満たしたことにはならない。未確認なら確認不足として扱う。
- コードレビュー中でも、指摘の正否が外部・対象領域の実装挙動に依存した時点で、通常レビューを中断して `investigation` / `public-research` に再分類する。
- レビュー指摘への対応依頼は、レビュー実行ではなく指摘検証から始める。指摘を `Review finding record` として扱い、採否分類が終わるまで修正へ進めない。
- 採用した指摘を修正する場合は、`Review response contract` を固定する。対応は `accepted` の指摘だけを対象にし、便乗修正をしてはならない。
- 対応後は、元指摘の解消と、修正が別観点の新規問題を生んでいないことを監査する。
- code / diff の対応後監査は `code-review`、再利用される日本語文章の対応後監査は `japanese-doc-review` を使う。一方を他方の代替にしてはならない。
- この失敗パターンは、シェーダーレビューの後続質問で `_rt_resolvedfullframedepth` の実装仕様確認に切り替わったケースを回帰検証候補として扱う。

## Task frame と capability pack の原則

- 非自明なユーザー発話は、単一の経路 / 主担当 skill に圧縮する前に task frame として扱う。
- task frame には、少なくとも返すもの、作業モード、継続関係、正否に効く主張、必要な根拠種別、プロジェクト規則、ドメイン規則、必要な capability pack を含める。
- skill は排他的な行き先ではなく、task frame の義務を満たすために付与する capability pack として扱う。
- 目標は「skill 数を最小化する」ことではなく、「十分な source coverage と主張制御を満たす最小の義務集合」にすること。
- 主出力は最終出力の形を決めるために使ってよいが、根拠確認義務や主張の権限を免除しない。
- ローカルの原本が必要な根拠種別に入った時点で、public-research は補助情報になり、ローカル根拠の調査を置き換えない。
- 以前のレビュー文脈は仮説や確認対象の由来として扱い、実装挙動の確認義務そのものは investigation / source coverage に分解する。

## 現行カバレッジ確認ポリシー

- 過去セッションから抽出した失敗事例は、現行プロンプトの未修正問題とは限らない。
- 古い失敗事例を corrective action に進める前に、現行の prompt / skill / agent / command / routing / hook / harness / artifact 構成で既に対策済みかを確認する。
- 既に対策済みの失敗は、追加のプロンプト変更ではなく、必要に応じて回帰検証シナリオとして扱う。
- 現行プロンプトに関連する規則があるだけでは、対策済みとはみなさない。少なくとも発火条件、必須行動、禁止行動、validation target、routing、artifact、hook、harness のいずれかが具体的に存在することを確認する。
- 現行カバレッジが `unknown` の場合は、通常の改善ではなく、まず triage で確認する。

## 介入種別の選択方針

- 改善手段はプロンプト編集に限定しない。
- triage では、少なくとも次の介入種別を比較する。
  - `no_change`
  - 回帰検証シナリオ
  - 既存文言の削除・言い換え・統合・移設
  - skill の分割・統合・新設・削除
  - command 再設計
  - agent routing または model / 推論量 routing の変更
  - artifact schema、状態ファイル、根拠対応表、索引などの導入
  - plugin / hook / harness による機械的な検査・保存・完了ゲート
  - empirical-prompt-tuning または retrospective-codify への移送
- 原則として、最小で検証可能な介入を選ぶ。
- prompt の追記は、最小介入の一種でしかない。再発防止に必要な制御が prompt では安定しない場合は、hook、harness、artifact、workflow の変更を優先して検討する。
- triage が hook、plugin、harness、artifact 実装、runtime 強制を推奨した場合、その推奨を文章だけの prompt rule に矮小化してはならない。prompt 面で行うのは、その介入への handoff や所有境界の明確化だけに留める。
- 一件の弱い失敗から共有規則を追加してはならない。
- 既存文言の削除・言い換え・統合・移設で足りる場合は、新規ルールを追加しない。
- 新規ルールを追加してよいのは以下をすべて満たす場合だけ：
  1. 現行システムで未対応の `active_gap` である
  2. 既存規則で包含できない
  3. 既存規則の表現を整理しても防げない
  4. 配置変更や skill 化だけで解決しない
  5. hook、artifact、harness ではなく prompt に置く方が適切である
  6. 新規規則の方が既存規則群より短く明確である
  7. 検証方法または回帰シナリオを定義できる

## prompt surface 階層介入ポリシー

- `/report-failure` は失敗の記録に使い、ここから直接広域の階層整理を始めない。
- `/add-capability` は単一 capability の追加・補強に使い、広い統合・重複整理・複数層の棚卸しは `/refine-prompt` に送る。
- `/refine-prompt` は階層を意識した prompt surface 介入に使い、単一ファイルの最適化ではなく、関係する層の配置・重複・不足をまとめて確認する。
- `covered_but_unvalidated` はプロンプト編集要件ではなく検証優先の状態として扱い、検証失敗または現行システムでの再発確認なしに prompt 変更へ進めない。
- 階層リファクタでは、挙動上意味のある指示を削除するときは、同層で言い換えるか、より適切な層へ明示的に移して保存する。
- 階層リファクタでは、短さだけでなく完全性も監査し、目的、発火条件、必須出力、禁止行動、validation target のいずれかが層全体から消えないようにする。

## リファクタリングのトリガー

- 同じ趣旨の規則を2回以上追加した
- 同じ失敗が別の agent / skill でも起きた
- 常設 prompt の一部が 20〜30% 以上増えた
- 新しい skill を作った、または AGENTS.md に作業固有の文が増えた
- failure-log の triage で、prompt ではなく hook、harness、artifact、agent routing、workflow contract が適切だと判断された
- 古い失敗事例と現行システムの対策済み事例が混ざり、追加修正と回帰検証の区別が曖昧になった

## 運用フロー

- 新しい失敗が起きたとき
  1. ローカル失敗ログルートに事例ごとのファイルとして記録する
  2. 現象、推定原因、介入候補を分ける
  3. 現行システムで既に対策済みか確認する
  4. `active_gap` の場合のみ是正対応候補に進める
  5. `covered_but_unvalidated` の場合は、追加修正ではなく回帰検証候補にする
  6. `likely_addressed` / `obsolete_context` の場合は履歴メモに留める
- 一定量たまったら
  1. triage で観測現象ごとにクラスタリングする
  2. 現行カバレッジを確認し、`obsolete_context` / `likely_addressed` / `covered_but_unvalidated` / `active_gap` / `unknown` を分ける
  3. `active_gap` と高リスクの `unknown` だけを改善介入の主対象にする
  4. プロンプト編集、skill 変更、command 再設計、agent routing、artifact、hook、harness、検証シナリオ、`no_change` を比較する
  5. 最小で検証可能な介入を選ぶ
  6. 差分レビューを行い、必要な補足は関連する失敗報告または triage レポートに残す

## 関連ファイル

- opencode-prompt-dev/prompt-principles.md
  - このファイル。プロンプト改善と改善介入の管理原則を示す。
- opencode-prompt-dev/english-token-allowlist.md
  - prompt、command、agent、skill 本文に残す英語の分類と判断順序を示す。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/`
  - ローカル限定の失敗・採掘・triage 記録。生ログや未整理の証拠はここに閉じる。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/session-mining/`
  - 過去セッションから抽出した失敗候補と傾向分析を保存する。
- `~/.local/share/chezmoi/.opencode/local-failure-logs/triage/`
  - 蓄積した失敗事例の分析、現行カバレッジ判定、介入案、検証案を保存する。
- opencode-prompt-dev/prompt-refactor-checklist.md
  - 冗長な記載、曖昧なルール、過剰なプロンプト編集を避けるためのチェックリスト。
