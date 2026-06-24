## プロンプト運用に使うファイル

- プロンプト運用の正本と運用テンプレートはリポジトリ内に分離して管理しています。
  - プロンプト運用原則: opencode-prompt-dev/prompt-principles.md
  - 失敗記録:
    - 標準のローカル失敗ログ保存先: `~/.local/share/chezmoi/.opencode/local-failure-logs/`
    - 失敗記録手順: `dot_config/opencode/agents/report-failure.md`
    - セッション採掘手順: `dot_config/opencode/agents/extract-failure-patterns.md`
    - triage 手順: `dot_config/opencode/agents/triage-failure.md`
    - リファクタチェックリスト等: opencode-prompt-dev/prompt-refactor-checklist.md
- 失敗ログ、セッション採掘レポート、triage レポートは原則としてローカル失敗ログルートに保存し、追跡対象ファイルには運用規則と確定済みの改善だけを残します。
- 失敗や改善案はまず上記の失敗ログに記録し、その後リファクタワークフローで差分を適用してください。

## プロンプトに使用する言語

- agent システムプロンプトと command prompt は次の方針で書いてください。
  - frontmatter `description`: 英語の発火語を主にし、必要なら短い日本語要約を1文だけ添える。詳細手順は書かない。
  - 本文: 日本語で短く書く。逐語翻訳ではなく、役割、条件、手順、禁止事項、出力、完了条件を箇条書き中心に再設計する。
  - 制御語彙は英語のまま維持する。例: agent 名、skill 名、router 名、schema field、status 値、severity 値、handoff 名、`work_class`、`execution_route`、`task_kind`、`mode_constraint`、`side_effect_mode`。
  - 英語維持語彙の棚卸しは `opencode-prompt-dev/english-token-allowlist.md` を正本にする。
  - 制御語彙以外の英語は原則として使わない。残す場合は、本文の近くで意味が分かるように書く。
  - output schema、frontmatter key、template include 名、command 名は既存の英語を維持する。
  - 長い理由説明は agent prompt 本体に置かず、運用メモ、report、reference に分離する。
  - prompt 本体の日本語は丁寧語を避け、仕様書的な短文を優先する。
- 対象ファイル:
  - ./.opencode/commands/\*.md
  - ./dot_config/opencode/agents/\*.md
  - ./dot_config/opencode/agents/\*.md.tmpl
  - ./dot_config/opencode/commands/\*.md
  - ./dot_config/opencode/AGENTS.md
  - ./.chezmoitemplates/opencode/AGENTS.md
  - ./.chezmoitemplates/opencode/agents/\*.md
  - ./.chezmoitemplates/opencode/parent/\*.md
- スキル定義は次の方針で書いてください。
  - `name`: 英語の kebab-case を維持する。
  - frontmatter `description`: 英語の発火語を主にし、必要なら短い日本語要約を1文だけ添える。詳細手順は書かない。
  - 本文: 日本語で短く書く。逐語翻訳ではなく、用途、手順、出力、チェックを箇条書き中心に再設計する。
  - 制御語彙は英語のまま維持する。例: skill 名、router 名、schema field、handoff 名、status 値、severity 値、`unknown`、`repo_derivable`、`public_fact`、`user_provided`、`acceptance criteria`、`verification method`。
  - 英語維持語彙の棚卸しは `opencode-prompt-dev/english-token-allowlist.md` を正本にする。
  - 制御語彙以外の英語は原則として使わない。残す場合は、本文の近くで意味が分かるように書く。
  - command skill template の本文が `dot_config/opencode/agents/*.md` を include する場合、include 先の言語規則に従う。
- 失敗事例、プロンプト運用規則など、プロンプトを改良するためのワークフローに関する記載は日本語で書いてください。具体的には以下のファイルが対象です。
  - ./opencode-prompt-dev/\*.md
  - ./AGENTS.md

## プロンプト階層定義

1. グローバル AGENTS.md (.chezmoitemplates/opencode/AGENTS.md)
   - すべてのエージェントに適用される共通規則。
   - 可能な限り小さく抑える。
   - 分岐を書いてはいけない。Build エージェントの場合は～などと書きたくなったら、それは書くべき階層が異なる。
2. エージェント システムプロンプト (dot_config/opencode/agents/\*.md, dot_config/opencode/agents/\*.md.tmpl)
   - Build、Plan、subagent、command agent に対応したシステムプロンプト。
   - 要求の分類やエージェント固有の規則を書く。
   - 具体的な作業内容については言及してはいけない。スキルへの誘導はよい。
3. 親エージェント用の委譲調整テンプレート (.chezmoitemplates/opencode/parent/\*.md)
   - primary agent がサブエージェントへ委譲するときの判断、並列化条件、assignment packet を書く。
   - subagent prompt には展開しない。
4. subagent 契約テンプレート (.chezmoitemplates/opencode/agents/\*.md)
   - subagent が受け取った assignment をどう解釈し、どの形式で返すかを書く。
   - 親エージェント側の並列委譲調整は書かない。
5. skill descriptions (dot_agents/skills/\*/SKILL.md または SKILL.md.tmpl のフロントマターに書く `description` フィールド)
   - **1024文字以内で書く。**
   - 英語の発火語を維持し、必要なら短い日本語要約を添える。
   - description だけで、使う条件、使わない条件、得られるものが判断できるように書く。
   - 近い skill と競合しやすい境界は、description の中で明示する。
   - 詳細手順、固定 schema、長い checklist は書かない。
6. スキル本文 (dot_agents/skills/\*/SKILL.md または SKILL.md.tmpl の本文)
   - description が決めた用途を前提に、手順、出力契約、検査、局所判断規則を具体的に書く。
   - description に書いた使用条件を重ね書きしない。
   - 日本語で短く書く。丁寧語を避け、仕様書的な短文と箇条書きを優先する。
   - 制御語彙、field 名、skill 名、output schema 名は英語のまま維持する。

## プロンプト設計・改良における外部調査

このリポジトリでプロンプトの追加、改良、失敗分析、階層整理を行うとき、外部の指針や現在の実務が品質に実質的な影響を与えうる場合は、ローカルの prompt 群だけを根拠に確定してはならない。

プロンプトや workflow のルールを「変えるべきか判断する」依頼は、次に repository 変更へ進む前提が明示される場合のみ、リポジトリ変更意図を含むものとして扱う。
相談・助言のみで即時の実装移行を要求しない場合は、純粋な方針相談として扱う。
ただし、実装前の判断でも明確に変更判断が要求されている場合は、外部調査中も `context-clarification` を capability set に残す。

特に次のいずれかに当てはまる場合は、関連 command 側で外部調査の要否を判定すること。

- 現在のベストプラクティスが設計を実質的に左右しうる
- source policy、evidence standards、privacy、security、validation strategy を変更する
- 用語、手法、規範が曖昧・未確定・変化中である
- public research、refactoring、technical writing、verification procedure など、分野固有の実務慣行が品質に影響する

外部調査が必要な場合は `public-research` を用いること。

ここでは「いつ調べるべきか」という原則だけを定める。
調査手順そのものは `public-research` に置き、実際の判定と反映は `/add-capability` や `/refine-prompt` などの command 側で行う。
